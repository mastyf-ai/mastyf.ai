# Contributing to Mastyf.ai

First off, thank you for your interest in contributing to Mastyf.ai.

We're a very small team, and we're definitely not the jack of all trades.

If you'd like to contribute, we'd wholeheartedly appreciate any help. Whether it's development, fixing bugs, improving documentation, testing, or even a simple feature request, it all goes a long way.

## Ways to Contribute

There are many ways to help improve Mastyf.ai:

* Report bugs
* Suggest new features
* Improve documentation
* Fix issues
* Add support for new AI providers
* Improve detection accuracy
* Add benchmark datasets
* Contribute new attack techniques (a working bypass of the current release is reported privately first: see [Public or private?](#public-or-private))
* Improve performance
* Enhance the dashboard or developer experience

## Before You Start

Before opening a large pull request:

* Check whether a similar issue or PR already exists.
* Open an issue to discuss significant architectural or feature changes.
* Keep pull requests focused on a single topic whenever possible.

## Getting Set Up

You need Git and Node.js 20 or newer. pnpm comes with Node through Corepack.

```bash
git clone https://github.com/mastyf-ai/mastyf.ai.git
cd mastyf.ai
corepack enable
pnpm install
pnpm dashboard:proxy      # dashboard at http://localhost:4000, keep this terminal open
```

Before you open a pull request:

```bash
pnpm lint                 # type-check
pnpm test                 # unit and integration tests
pnpm eval                 # attack corpus: every attack blocked, every harmless call allowed
```

Run `pnpm eval` whenever you touch the policy engine, the default policy or a detector. A change that lets one corpus attack through, or blocks one harmless call, needs a very good reason.

## Development Guidelines

Please follow these principles:

* Keep changes small and focused.
* Write clear, maintainable code.
* Avoid unnecessary dependencies.
* Follow the existing project structure and coding style.
* Add tests whenever possible.
* Update documentation if behavior changes.

## Security Contributions

Security is the core of this project.

We're especially interested in contributions involving:

* Prompt injection research
* Jailbreak techniques
* Tool abuse
* SSRF
* Path traversal
* Shell injection
* Sensitive data leakage
* MCP security
* Agent security
* Adversarial datasets
* Detection improvements
* False positive reduction

### Public or private?

* **Public is fine** (issues, pull requests, Discussions): detection ideas, false positive fixes, new attack *classes* described in general terms, and attack datasets built from techniques that are already public.
* **Private first:** anything that works against the current release. A prompt, payload, path or sequence of calls that gets past Mastyf, leaks a secret, or reaches the dashboard without signing in is a vulnerability, even if it's "just" a clever bypass. Report it as described below. Once it's fixed, we'd love a pull request adding it to the attack corpus, with credit to you.

## Reporting Security Vulnerabilities

Please do **not** open a public GitHub issue, pull request or Discussion for a security vulnerability or a working bypass.

Report it privately, in either of these ways:

* Email **[mastyf.support@gmail.com](mailto:mastyf.support@gmail.com)**
* Open a [private security advisory](https://github.com/mastyf-ai/mastyf.ai/security/advisories/new) on GitHub

The details we need are in our [Security Policy](SECURITY.md). We will investigate reports promptly and coordinate responsible disclosure where appropriate.

## Reviews and Feedback

Tried Mastyf on your own agents? We'd love an honest review: what worked, what broke, and what you want it to catch next. Send it to **[mastyf.support@gmail.com](mailto:mastyf.support@gmail.com)**. Questions and ideas are also welcome in [Discussions](https://github.com/mastyf-ai/mastyf.ai/discussions).

## Pull Request Checklist

Before submitting your pull request, please ensure that:

* Your branch is up to date.
* The project builds successfully.
* Tests pass.
* New functionality includes tests where appropriate.
* Documentation has been updated if necessary.
* Commit messages are meaningful.

## Code Style

Please:

* Follow the existing coding conventions.
* Keep functions and modules focused.
* Prefer readability over cleverness.
* Avoid introducing breaking changes unless discussed beforehand.

## Feature Requests

Feature requests are welcome.

When opening one, please include:

* The problem you're trying to solve
* Your proposed solution
* Alternative approaches you've considered
* Any relevant references

## License

By contributing to Mastyf.ai, you agree that your contributions will be licensed under the same license as the project.
