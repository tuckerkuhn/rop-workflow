const steps = [
  ["1", "Plan the season", "Training, field dates, owners, input plan, budget links, MEL questions"],
  ["2", "Train farmers", "Enrolled farmers with contribution paid; attendance as evidence"],
  ["3", "Prepare land", "Plot linked to farmer, crop, season, and project"],
  ["4", "Verify readiness", "Joint Extension + MEL visit: Yes / No"],
  ["5a", "If Yes: distribute inputs", "Package, quantities, recipient, expenditure evidence"],
  ["5b", "If No: correct & recheck", "Deadline, recheck, removal if unresolved"],
  ["6", "Plant & follow up", "Planting and field-visit records, harvest data when due"],
  ["7", "Analyze & act", "Validated MEL findings, management actions with owners and dates"],
];

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <p className="text-sm font-medium uppercase tracking-wide text-emerald-700">Prototype · synthetic data</p>
      <h1 className="mt-2 text-3xl font-semibold">ROP Seasonal Workflow</h1>
      <p className="mt-3 text-neutral-600">
        Farm preparation to MEL follow-up. Answers: is this farmer ready for inputs, what happened, and what needs
        action, by whom, by when?
      </p>
      <ol className="mt-8 divide-y rounded-lg border">
        {steps.map(([n, title, detail]) => (
          <li key={n} className="flex gap-4 p-4">
            <span className="w-8 shrink-0 font-mono text-sm text-neutral-500">{n}</span>
            <div>
              <p className="font-medium">{title}</p>
              <p className="text-sm text-neutral-600">{detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}
