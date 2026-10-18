export default function GoalIcon({ name }: { name: "details" | "edit" | "delete" | "achievement" }) {
  return <svg className="goal-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === "details" && <><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/></>}
    {name === "edit" && <><path d="m15 5 4 4M4 20l4.5-1 11-11a2.8 2.8 0 0 0-4-4l-11 11L4 20Z"/><path d="M13 20h7"/></>}
    {name === "delete" && <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/></>}
    {name === "achievement" && <><path d="M4 19V5M4 19h16M8 14l4-5 4 3 4-7M16 5h4v4"/></>}
  </svg>;
}
