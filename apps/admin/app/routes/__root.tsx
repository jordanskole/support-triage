import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "ac-1 board" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <ChakraProvider value={defaultSystem}>
          <QueryClientProvider client={queryClient}>
            <Outlet />
          </QueryClientProvider>
        </ChakraProvider>
        <Scripts />
      </body>
    </html>
  );
}
