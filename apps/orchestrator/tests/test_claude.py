"""Prompt assembly and response parsing.

The property worth protecting here is the auto-resolve safety default: this
pipeline really closes real tickets, so a malformed or absent judgement must
route to a human rather than resolve. Anything other than an explicit boolean
true is a route.
"""
import pytest

from llm.claude import (ClassificationError, _first_text, _no_dashes,
                        build_classify_prompt, parse_classification)


class _Block:
    """Stand-in for an SDK content block."""
    def __init__(self, text=None):
        if text is not None:
            self.text = text


class _Thinking:
    """A ThinkingBlock has no .text at all. Accessing it raises, which is what
    broke production: msg.content[0].text on a thinking-first response."""
    def __getattr__(self, item):
        raise AttributeError(item)


class _Msg:
    def __init__(self, *blocks):
        self.content = list(blocks)


class TestFirstText:
    def test_plain_text_first(self):
        assert _first_text(_Msg(_Block("hello"))) == "hello"

    def test_skips_a_leading_thinking_block(self):
        """The production regression. content[0] was a ThinkingBlock and indexing
        it raised AttributeError, killing the run mid-pipeline."""
        assert _first_text(_Msg(_Thinking(), _Block("payload"))) == "payload"

    def test_skips_blocks_with_blank_text(self):
        assert _first_text(_Msg(_Block("   "), _Block("real"))) == "real"

    def test_raises_when_no_text_block_exists(self):
        with pytest.raises(ClassificationError):
            _first_text(_Msg(_Thinking()))

    @pytest.mark.parametrize("empty", [_Msg(), None])
    def test_handles_absent_content(self, empty):
        with pytest.raises(ClassificationError):
            _first_text(empty if empty is not None else _Msg())


class TestParseClassification:
    def _base(self, **over):
        d = {"department": "Software", "urgency": "Low", "summary": "s",
             "self_serviceable": True, "reason": "r"}
        d.update(over)
        return __import__("json").dumps(d)

    def test_parses_a_well_formed_response(self):
        out = parse_classification(self._base())
        assert out["department"] == "Software"
        assert out["self_serviceable"] is True

    def test_strips_markdown_fences(self):
        assert parse_classification("```json\n" + self._base() + "\n```")["urgency"] == "Low"

    def test_rejects_an_unknown_department(self):
        """Routing to a department Jira does not have would fail the write later,
        further from the cause."""
        with pytest.raises(ClassificationError):
            parse_classification(self._base(department="Astrophysics"))

    # --- the safety default ---

    @pytest.mark.parametrize("value", [False, "true", "yes", 1, None, 0, [], "True"])
    def test_only_boolean_true_authorises_auto_resolve(self, value):
        """A string "true", a 1, or a missing key must NOT auto-close a ticket.
        This is the guard on `is True` rather than a truthiness check."""
        assert parse_classification(self._base(self_serviceable=value))["self_serviceable"] is False

    def test_absent_judgement_routes_to_a_human(self):
        import json
        raw = json.dumps({"department": "Hardware", "urgency": "High", "summary": "s"})
        assert parse_classification(raw)["self_serviceable"] is False

    def test_reason_has_dashes_normalised(self):
        out = parse_classification(self._base(reason="needs a human — hardware fault"))
        assert "—" not in out["reason"]


class TestClassifyPrompt:
    def test_asks_for_the_judgement_and_a_reason(self):
        p = build_classify_prompt("t", "b")
        assert "self_serviceable" in p and "reason" in p

    def test_omits_duplicate_context_when_none_found(self):
        assert "Similar tickets" not in build_classify_prompt("t", "b")

    def test_includes_duplicates_so_the_judgement_can_use_them(self):
        """Agent 1's read feeds this. Without it the model cannot know a ticket is
        a duplicate, which is one of the stated reasons to route."""
        p = build_classify_prompt("t", "b", ["ITSD-1 same thing", "ITSD-2 also this"])
        assert "ITSD-1 same thing" in p and "Similar tickets" in p

    def test_caps_the_duplicate_list(self):
        p = build_classify_prompt("t", "b", [f"ITSD-{i} x" for i in range(20)])
        assert p.count("ITSD-") <= 5


def test_no_dashes_collapses_artefacts():
    assert "—" not in _no_dashes("a — b")
    assert ", ," not in _no_dashes("a — , b")
