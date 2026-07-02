// Atlas brandmark: three chevrons decreasing in scale, terminating in a
// filled dot, drawing the nested `act` claim (sub -> act.sub -> act.act.sub)
// as a shape, rather than a generic "linked nodes" agent cliché. Colors
// mirror tailwind.config.ts's accent (#7AA2FF) -> resolve (#4ED492) tokens;
// keep them in sync if that palette ever changes.
export default function AtlasMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <path d="M6 6 L16 16 L6 26" stroke="#7AA2FF" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 10 L20 16 L12 22" stroke="#64BBC8" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 13 L23 16 L17 19" stroke="#4ED492" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="25" cy="16" r="1.8" fill="#4ED492" />
    </svg>
  );
}
