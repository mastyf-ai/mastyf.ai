/** Benign argument strings for learned-rule false-positive validation. */
export const BENIGN_ARGUMENT_SAMPLES: readonly string[] = [
  "weather forecast for Seattle",
  "SELECT id, name FROM products WHERE active = true LIMIT 10",
  "README.md project setup instructions",
  "/workspace/docs/api-reference.md",
  "summarize the meeting notes from yesterday",
  "translate hello to French",
  "list files in the current directory",
  "calculate 15 percent tip on 42.50",
  "what is the capital of Norway",
  "format this JSON with 2-space indent",
];

/** Benign tool descriptions for local-semantic learned-rule FP validation. */
export const BENIGN_DESCRIPTION_SAMPLES: readonly string[] = [
  "Search the web for current information on a topic.",
  "Read a text file from the workspace and return its contents.",
  "Execute a SQL query against the read-only analytics database.",
  "Send an email notification to the configured admin address.",
  "Before running tests, ensure dependencies are installed with npm install.",
  "First validate the input, then return the formatted result to the user.",
  "Upload the generated report to the internal S3 bucket.",
  "Returns JSON schema documentation from schema.org.",
  "Query the knowledge base and summarize relevant passages.",
  "List available tools and their descriptions for the agent.",
];
