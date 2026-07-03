import TokenInspector from "@/components/TokenInspector";

export const metadata = { title: "Token Inspector · Atlas Identity Operations Center" };

export default function Tokens() {
  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <TokenInspector />
    </div>
  );
}
