import { createFileRoute } from "@tanstack/react-router";
import { parseExample } from "@support-triage/schema";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const example = parseExample({
    id: "1",
    name: "Hello from @support-triage/schema",
    createdAt: new Date().toISOString(),
  });

  return (
    <main>
      <h1>Support Triage</h1>
      <p>{example.name}</p>
    </main>
  );
}
