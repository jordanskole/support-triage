import { createFileRoute } from "@tanstack/react-router";
import { parseExample } from "@ac-1/schema";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const example = parseExample({
    id: "1",
    name: "Hello from @ac-1/schema",
    createdAt: new Date().toISOString(),
  });

  return (
    <main>
      <h1>ac-1</h1>
      <p>{example.name}</p>
    </main>
  );
}
