# Contributing to MCP Doctor

Thanks for helping make MCP infrastructure safer!

## Quick Start

```bash
git clone https://github.com/rudraneel93/mcp-doctor.git
cd mcp-doctor
npm install
npm run build
npm test        # 52 unit tests
npm run dev     # watch mode
```

## Project Structure

```
src/
├── index.ts                 # MCP server entry (stdio)
├── cli.ts                   # CLI wrapper
├── container.ts             # Dependency injection
├── types.ts                 # Shared interfaces
├── config-parser.ts         # Config file parsing
├── services/                # Orchestrators
├── scanners/                # Security checks
├── clients/                 # External API clients
├── database/                # SQLite via sql.js
├── reporter/                # Output formatting
└── utils/                   # Shared utilities
tests/                       # Vitest test suite
```

## Development Workflow

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Write tests for your changes
4. Run `npm run build && npm test` — all must pass
5. Commit with conventional commits: `feat:`, `fix:`, `docs:`, `test:`
6. Push and open a PR

## Adding a New Scanner

1. Create `src/scanners/my-scanner.ts` implementing a class with a `scan()` or `check()` method
2. Add it to `src/container.ts` dependency graph
3. Write tests in `tests/my-scanner.test.ts`
4. If needed, wire it into `src/services/security-scanner.ts`

## Adding a New Pricing Model

Add an entry to the `DEFAULT_PRICING_TABLE` in `src/clients/pricing-client.ts`. 
Or set `PRICING_OVERRIDES` env var: `{"my-model": {"input": 2.5, "output": 7.5}}`

## Code Style

- TypeScript strict mode
- Prefer named exports over default
- Use `async/await` over raw promises
- Log via `Logger` not `console.log`
- Test files mirror source structure

## Questions?

Open an issue at https://github.com/rudraneel93/mcp-doctor/issues