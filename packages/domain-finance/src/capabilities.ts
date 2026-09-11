import { defineBoundary, defineCapability, defineRegistry } from '@nextgen/core-capability';

/**
 * The finance domain's capabilities.
 *
 * This file is the source of truth. `eval/registry.json`, the route table and the
 * embedding index are generated from it — run `pnpm registry:build`. Editing the
 * generated JSON directly gets overwritten and, worse, drifts in the meantime.
 *
 * Rule 1 runs one way: this package imports the engine contract from
 * `core-capability`. No `core-*` package imports this one.
 */

export const capabilities = [
  defineCapability({
    id: "home.dashboard",
    explanation:
      "Your starting point: this month’s spending, how each budget is doing, and the most recent transactions in one place.",
    explanationSource: "packages/domain-finance/src/capabilities.ts",
    kind: "navigate",
    route: "/",
    title: "Home",
    description:
      "Open the home dashboard with an overview of balances, recent activity and budget status",
    triggers: ["home", "dashboard", "main screen", "start", "overview"],
    examples: [
      "go home",
      "take me to the dashboard",
      "show me the overview",
    ],
  }),
  defineCapability({
    id: "transactions.list",
    explanation:
      "Every transaction you have recorded, newest first. Filter by date, category or account to narrow it down.",
    explanationSource: "packages/domain-finance/src/capabilities.ts",
    kind: "navigate",
    route: "/transactions",
    title: "Transactions",
    description:
      "Browse and filter the full list of recorded transactions over a period",
    triggers: ["transactions", "my transactions", "transaction list", "all transactions"],
    params: {
      from: { type: "date", required: false },
      to: { type: "date", required: false },
      category: { type: "enum:Category", required: false },
      account: { type: "enum:Account", required: false },
    },
    examples: [
      "show me my transactions",
      "open last month's expenses",
      "list all transactions from this week",
    ],
  }),
  defineCapability({
    id: "search.transactions",
    explanation:
      "Finding particular transactions by describing them — a shop name, an amount, a rough date.",
    explanationSource: "packages/domain-finance/src/capabilities.ts",
    kind: "read",
    route: "/transactions/search",
    title: "Search transactions",
    description:
      "Find specific transactions by merchant name, memo text or exact amount",
    triggers: ["find transaction", "search for", "look for a payment", "which transaction"],
    params: {
      query: { type: "string", required: true },
      from: { type: "date", required: false },
      to: { type: "date", required: false },
    },
    examples: [
      "find the payment to Amazon",
      "search for transactions mentioning refund",
      "did I pay anything to the dentist",
    ],
  }),
  defineCapability({
    id: "transaction.create",
    explanation:
      "Recording something you spent or received. I take you to the form with whatever you already told me filled in; you check it and save.",
    explanationSource: "packages/domain-finance/src/capabilities.ts",
    kind: "write",
    route: "/transactions/new",
    title: "Add transaction",
    description:
      "Record a new expense or income entry with an amount, category and date",
    triggers: [
      "add transaction",
      "record expense",
      "log a payment",
      "new expense",
      "add income",
    ],
    params: {
      amount: { type: "money", required: true },
      category: { type: "enum:Category", required: false },
      date: { type: "date", required: false },
      account: { type: "enum:Account", required: false },
      merchant: { type: "string", required: false },
    },
    examples: [
      "I spent 12 euros on coffee",
      "add an expense of 45 for groceries",
      "log 2000 salary income today",
    ],
  }),
  defineCapability({
    id: "transaction.update",
    explanation:
      "Correcting a transaction you already recorded — its amount, date, category or description.",
    explanationSource: "packages/domain-finance/src/capabilities.ts",
    kind: "write",
    route: "/transactions/edit",
    title: "Edit transaction",
    description:
      "Change the amount, category or date of an existing transaction",
    triggers: [
      "edit transaction",
      "change that transaction",
      "fix the category",
      "correct the amount",
    ],
    params: {
      target: { type: "string", required: true },
      amount: { type: "money", required: false },
      category: { type: "enum:Category", required: false },
      date: { type: "date", required: false },
    },
    examples: [
      "change that to groceries",
      "edit the last transaction amount to 20",
      "recategorise the Amazon payment as electronics",
    ],
  }),
  defineCapability({
    id: "transaction.delete",
    explanation:
      "Removing a transaction you recorded by mistake. I ask you to confirm first, and it can be undone afterwards.",
    explanationSource: "packages/domain-finance/src/capabilities.ts",
    kind: "destructive",
    route: "/transactions",
    title: "Delete transaction",
    description:
      "Permanently remove a single transaction from the record",
    triggers: ["delete transaction", "remove that entry", "erase the payment"],
    params: {
      target: { type: "string", required: true },
    },
    examples: [
      "delete that transaction",
      "remove the duplicate coffee entry",
      "erase the last expense I added",
    ],
  }),
  defineCapability({
    id: "spending.total",
    explanation:
      "What you spent over a period, added up. The figure is computed from your records, never estimated.",
    explanationSource: "packages/domain-finance/src/capabilities.ts",
    kind: "read",
    route: "/analytics/total",
    title: "Total spending",
    description:
      "Report the single total amount spent across all categories in a period",
    triggers: ["how much did I spend", "total spending", "what did I spend overall"],
    params: {
      from: { type: "date", required: false },
      to: { type: "date", required: false },
      account: { type: "enum:Account", required: false },
    },
    examples: [
      "how much did I spend last month",
      "what's my total spending this year",
      "how much have I spent overall this week",
    ],
  }),
  defineCapability({
    id: "spending.by_category",
    explanation:
      "The same spending split by category, so you can see where the money actually went.",
    explanationSource: "packages/domain-finance/src/capabilities.ts",
    kind: "read",
    route: "/analytics/category",
    title: "Spending by category",
    description:
      "Break spending down per category, or report the amount spent on one specific category",
    triggers: [
      "spending by category",
      "how much on",
      "category breakdown",
      "where did my money go",
    ],
    params: {
      category: { type: "enum:Category", required: false },
      from: { type: "date", required: false },
      to: { type: "date", required: false },
    },
    examples: [
      "how much did I spend on food last month",
      "break down my spending by category",
      "what did groceries cost me this year",
    ],
  }),
  defineCapability({
    id: "spending.trend",
    explanation:
      "How your spending has moved month to month, so a change shows up as a direction rather than a single number.",
    explanationSource: "packages/domain-finance/src/capabilities.ts",
    kind: "read",
    route: "/analytics/trend",
    title: "Spending trend",
    description:
      "Compare spending across consecutive periods to show whether it is rising or falling over time",
    triggers: ["spending trend", "am I spending more", "compare months", "over time"],
    params: {
      category: { type: "enum:Category", required: false },
      months: { type: "number", required: false },
    },
    examples: [
      "am I spending more than last month",
      "show my spending trend over six months",
      "is my food spending going up",
    ],
  }),
  defineCapability({
    id: "budget.view",
    explanation:
      "The budgets you have set, and how much of each is left this period.",
    explanationSource: "packages/domain-finance/src/capabilities.ts",
    kind: "navigate",
    route: "/budget",
    title: "Budgets",
    description:
      "Open the budgets screen listing every category limit that has been configured",
    triggers: ["budgets", "my budgets", "open budget", "budget screen"],
    examples: [
      "open my budgets",
      "show the budget screen",
      "take me to budgets",
    ],
  }),
  defineCapability({
    id: "budget.status",
    explanation:
      "Whether a particular budget is on track — what you have spent against it and what remains.",
    explanationSource: "packages/domain-finance/src/capabilities.ts",
    kind: "read",
    route: "/budget",
    title: "Budget status",
    description:
      "Report how much of a budget has been used and whether it is over or under the limit",
    triggers: ["am I over budget", "budget left", "how much is left", "on track"],
    params: {
      category: { type: "enum:Category", required: false },
      from: { type: "date", required: false },
    },
    examples: [
      "am I over budget on food",
      "how much of my budget is left",
      "am I on track this month",
    ],
  }),
  defineCapability({
    id: "budget.set",
    explanation:
      "Setting or changing the limit for a category. I take you to the form; you confirm the amount.",
    explanationSource: "packages/domain-finance/src/capabilities.ts",
    kind: "write",
    route: "/budget/edit",
    title: "Set budget",
    description:
      "Create or change the monthly spending limit for a category",
    triggers: ["set budget", "change my limit", "budget for", "cap spending"],
    params: {
      category: { type: "enum:Category", required: true },
      amount: { type: "money", required: true },
    },
    examples: [
      "set my food budget to 300",
      "change the groceries limit to 250 euros",
      "cap entertainment at 100 a month",
    ],
  }),
  defineCapability({
    id: "budget.delete",
    explanation:
      "Removing a budget you no longer want to track. Your transactions are untouched.",
    explanationSource: "packages/domain-finance/src/capabilities.ts",
    kind: "destructive",
    route: "/budget",
    title: "Remove budget",
    description:
      "Delete the configured spending limit for a category entirely",
    triggers: ["remove budget", "delete my limit", "stop tracking budget"],
    params: {
      category: { type: "enum:Category", required: true },
    },
    examples: [
      "remove my food budget",
      "delete the entertainment limit",
      "stop budgeting for transport",
    ],
  }),
  defineCapability({
    id: "accounts.list",
    explanation:
      "The accounts you track — current, savings, card — and what each holds.",
    explanationSource: "packages/domain-finance/src/capabilities.ts",
    kind: "navigate",
    route: "/accounts",
    title: "Accounts",
    description:
      "Open the screen listing all configured accounts and cards",
    triggers: ["accounts", "my accounts", "account list"],
    examples: [
      "show my accounts",
      "open the accounts screen",
      "list my cards",
    ],
  }),
  defineCapability({
    id: "account.balance",
    explanation:
      "The balance of one account, computed from the transactions recorded against it.",
    explanationSource: "packages/domain-finance/src/capabilities.ts",
    kind: "read",
    route: "/accounts",
    title: "Account balance",
    description:
      "Report the current balance held in one account or across all accounts",
    triggers: ["balance", "how much do I have", "what's in my account"],
    params: {
      account: { type: "enum:Account", required: false },
    },
    examples: [
      "what's my balance",
      "how much do I have in savings",
      "how much money is in my main account",
    ],
  }),
  defineCapability({
    id: "account.create",
    explanation:
      "Adding another account to track alongside the ones you already have.",
    explanationSource: "packages/domain-finance/src/capabilities.ts",
    kind: "write",
    route: "/accounts/new",
    title: "Add account",
    description:
      "Register a new account or card to track alongside the existing ones",
    triggers: ["add account", "new account", "create a card"],
    params: {
      name: { type: "string", required: true },
      type: { type: "enum:Account", required: false },
    },
    examples: [
      "add a savings account",
      "create a new credit card account",
      "set up an account called Holiday Fund",
    ],
  }),
  defineCapability({
    id: "categories.list",
    explanation:
      "The categories transactions can be filed under, and which ones you use most.",
    explanationSource: "packages/domain-finance/src/capabilities.ts",
    kind: "navigate",
    route: "/categories",
    title: "Categories",
    description:
      "Open the screen managing the category tree used to classify transactions",
    triggers: ["categories", "my categories", "manage categories"],
    examples: [
      "show my categories",
      "open category settings",
      "manage my categories",
    ],
  }),
  defineCapability({
    id: "settings.open",
    explanation:
      "Where you change how the app behaves — currency, defaults, and how your data is handled.",
    explanationSource: "packages/domain-finance/src/capabilities.ts",
    kind: "navigate",
    route: "/settings",
    title: "Settings",
    description:
      "Open the application settings screen",
    triggers: ["settings", "preferences", "options", "configuration"],
    examples: [
      "open settings",
      "go to preferences",
      "show me the options",
    ],
  }),
  defineCapability({
    id: "settings.currency",
    explanation:
      "Changing the currency amounts are shown in. It changes the display, never the recorded values.",
    explanationSource: "packages/domain-finance/src/capabilities.ts",
    kind: "write",
    route: "/settings/currency",
    title: "Change currency",
    description:
      "Change the default display currency used throughout the application",
    triggers: ["change currency", "set currency", "switch to dollars"],
    params: {
      currency: { type: "string", required: true },
    },
    examples: [
      "change my currency to dollars",
      "set the currency to GBP",
      "switch everything to euros",
    ],
  }),
  defineCapability({
    id: "export.data",
    explanation:
      "Taking your data out as a file you keep — everything recorded, in a format other tools can read.",
    explanationSource: "packages/domain-finance/src/capabilities.ts",
    kind: "read",
    route: "/settings/export",
    title: "Export data",
    description:
      "Export all stored financial data to a file the user can save elsewhere",
    triggers: ["export", "download my data", "backup"],
    params: {
      format: { type: "string", required: false },
    },
    examples: [
      "export my data",
      "download everything as CSV",
      "back up my transactions",
    ],
  }),
];

/**
 * The application's declared limits (ADR-009).
 *
 * These are matched by exactly the same retrieval as everything above, and
 * that is the point: out-of-scope detection becomes routing rather than a
 * judgement the model makes, so it behaves identically on a 1B model and an 8B
 * one. Measured, because no model is involved in it at all.
 *
 * ADR-004 rule 3 already drew this boundary — "no payments, no transfers, no
 * sending" — but drew it in prose, where no code could read it. Adding a
 * capability that crosses one of these lines now means deleting the boundary
 * entry forbidding it, which is a conspicuous thing to do in a diff.
 */
export const boundary = [
  defineBoundary({
    id: "unsupported.move_money",
    title: "Moving real money",
    description:
      "Making a payment, sending or transferring funds to another person, business, biller or account. Settling a bill. Any action that moves real money rather than recording that money moved.",
    triggers: ["make a payment", "send money", "transfer funds"],
    examples: [
      "send some money to a friend",
      "settle the gas bill",
      "move funds into my savings account",
    ],
    refusal:
      "I can record and analyse your transactions, but I can't move real money. Nothing here is connected to a payment provider.",
  }),
  defineBoundary({
    id: "unsupported.investing",
    title: "Investment and credit advice",
    description:
      "Buying, selling or holding investments, shares, funds or cryptocurrency. Advice on what to invest in. Credit scores, loan eligibility and creditworthiness.",
    triggers: ["investment advice", "credit rating"],
    examples: [
      "is it a good time to buy shares",
      "put my money into a fund",
      "how good is my borrowing record",
    ],
    refusal:
      "I track what you've spent and earned. I don't give investment or credit advice, and I have no access to credit data.",
  }),
  defineBoundary({
    id: "unsupported.subscriptions",
    title: "Managing external accounts",
    description:
      "Starting, changing or cancelling a subscription, contract or service with a third party. Acting on an external account rather than on the records held here.",
    triggers: ["cancel a subscription", "change my plan"],
    examples: [
      "end my gym membership",
      "downgrade my phone contract",
      "close that account with the provider",
    ],
    refusal:
      "I can show you what a subscription costs you, but I can't change or cancel anything with the provider.",
  }),
  defineBoundary({
    id: "unsupported.messaging",
    title: "Sending messages and files",
    description:
      "Sending an email, message or file to someone. Phoning or contacting a person. Sharing a document or photograph with anyone outside this app.",
    triggers: ["send a message", "email someone", "phone someone"],
    examples: [
      "write to my landlord about this",
      "share this with someone",
      "give my sister a ring",
    ],
    refusal:
      "I can't send messages or contact anyone. You can export your data and share it yourself.",
  }),
  defineBoundary({
    id: "unsupported.reminders",
    title: "Reminders, alarms and calendar",
    description:
      "Setting a reminder, alarm, timer or calendar appointment. Being prompted about something at a future time.",
    triggers: ["set a reminder", "set an alarm", "add to my calendar"],
    examples: [
      "nudge me about this next week",
      "wake me up early tomorrow",
      "put that in my diary",
    ],
    refusal:
      "I don't set reminders or alarms. I can show you an upcoming budget, but I can't prompt you about it.",
  }),
  defineBoundary({
    id: "unsupported.errands",
    title: "Booking and ordering things",
    description:
      "Ordering goods or food, booking travel, flights, tickets or reservations. Buying anything on the user's behalf.",
    triggers: ["book something", "order something"],
    examples: [
      "get me a table for two",
      "buy tickets for the match",
      "arrange a trip to Madrid",
    ],
    refusal:
      "I can't order or book anything. Once you've paid for it, I can record it as a transaction.",
  }),
  defineBoundary({
    id: "unsupported.general",
    title: "General assistant requests",
    description:
      "Anything unrelated to this person's money: the weather, the time, news, sport, jokes, trivia, general knowledge, translation, playing media, or controlling the device.",
    triggers: ["what is the weather", "tell me a joke", "what time is it"],
    examples: [
      "will it rain at the weekend",
      "say something funny",
      "how do you say this in another language",
    ],
    refusal:
      "That's outside what I do — I'm here for your accounts, spending and budgets.",
  }),
];

export const enums = {
    "Category": {
      "tree": {
        "food": [
          "groceries",
          "restaurants",
          "coffee",
          "takeaway"
        ],
        "transport": [
          "fuel",
          "public_transport",
          "taxi",
          "parking"
        ],
        "housing": [
          "rent",
          "utilities",
          "internet",
          "insurance"
        ],
        "entertainment": [
          "streaming",
          "games",
          "events",
          "books"
        ],
        "health": [
          "pharmacy",
          "doctor",
          "gym"
        ],
        "shopping": [
          "clothes",
          "electronics",
          "gifts"
        ],
        "income": [
          "salary",
          "freelance",
          "refund"
        ],
        "other": []
      },
      "aliases": {
        "food": [
          "eating",
          "eating out",
          "meals",
          "dining",
          "comida"
        ],
        "groceries": [
          "grocery",
          "supermarket",
          "market",
          "shopping for food"
        ],
        "restaurants": [
          "restaurant",
          "dining out",
          "eating out"
        ],
        "coffee": [
          "cafe",
          "coffees",
          "starbucks"
        ],
        "takeaway": [
          "takeout",
          "delivery",
          "uber eats"
        ],
        "transport": [
          "travel",
          "commute",
          "transportation",
          "transportes"
        ],
        "fuel": [
          "gas",
          "petrol",
          "gasoline",
          "diesel"
        ],
        "public_transport": [
          "bus",
          "metro",
          "train",
          "subway"
        ],
        "taxi": [
          "uber",
          "cab",
          "bolt"
        ],
        "housing": [
          "home",
          "house",
          "accommodation"
        ],
        "rent": [
          "renting",
          "landlord"
        ],
        "utilities": [
          "electricity",
          "water",
          "power",
          "gas bill"
        ],
        "internet": [
          "wifi",
          "broadband"
        ],
        "entertainment": [
          "fun",
          "leisure",
          "entretenimento"
        ],
        "streaming": [
          "netflix",
          "spotify",
          "subscriptions"
        ],
        "health": [
          "medical",
          "healthcare",
          "saude"
        ],
        "pharmacy": [
          "chemist",
          "drugstore",
          "farmacia"
        ],
        "gym": [
          "fitness",
          "workout"
        ],
        "shopping": [
          "retail",
          "purchases"
        ],
        "clothes": [
          "clothing",
          "apparel",
          "shoes"
        ],
        "electronics": [
          "gadgets",
          "tech"
        ],
        "income": [
          "earnings",
          "revenue",
          "money in"
        ],
        "salary": [
          "wage",
          "paycheck",
          "pay"
        ],
        "freelance": [
          "side work",
          "contract work",
          "gigs"
        ]
      }
    },
    "Account": {
      "values": [
        "main",
        "savings",
        "credit_card",
        "cash"
      ],
      "aliases": {
        "main": [
          "checking",
          "current",
          "main account",
          "everyday"
        ],
        "savings": [
          "savings account",
          "saver"
        ],
        "credit_card": [
          "credit",
          "card",
          "visa",
          "mastercard"
        ],
        "cash": [
          "wallet",
          "physical cash"
        ]
      }
    }
  };

export const registry = defineRegistry({
  schemaVersion: 1,
  domainDescription:
    'A personal finance tracker. It records transactions, budgets, categories ' +
    'and account balances for one user.',
  capabilities: [...capabilities, ...boundary],
  enums,
});
