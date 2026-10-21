// The teams as they were in Hygraph on 2026-10-21, ids included so the
// one-time Hygraph import lines up with seeded rows. Only fresh databases
// read this; edit live team copy in Prisma Studio.
export const TEAMS = [
  {
    id: "cmvfdpan4taih06lar04bdylr",
    name: "Support",
    description:
      "For existing customers who need help: troubleshooting, bugs, account access, or how-to questions about the product.",
    createdAt: "2026-10-19T14:57:50.340Z",
  },
  {
    id: "cmvfdpjmjsqyc06l8sb5mewss",
    name: "Sales",
    description:
      "For prospects and customers interested in buying: pricing, demos, plan upgrades, quotes, and new contracts.",
    createdAt: "2026-10-19T14:58:01.998Z",
  },
  {
    id: "cmvfdprvjsr8f06l8vb5djowo",
    name: "Finance",
    description:
      "For billing and payment matters: invoices, refunds, failed payments, tax documents, and vendor or procurement paperwork.",
    createdAt: "2026-10-19T14:58:12.688Z",
  },
  {
    id: "cmvfdq3e5srda06l8q7yo7d4o",
    name: "Product",
    description:
      "For feedback about the product itself: feature requests, roadmap questions, and suggestions for improving existing functionality.",
    createdAt: "2026-10-19T14:58:27.614Z",
  },
  {
    id: "cmvfdqy1gtboh06lapyi34mo9",
    name: "Agency/Channel",
    description: "For when its a reseller",
    createdAt: "2026-10-19T14:59:07.332Z",
  },
] as const satisfies readonly {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}[];
