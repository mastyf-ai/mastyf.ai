# Security Policy

Thank you for helping keep Mastyf.ai secure.

As an AI security platform, security is at the heart of everything we build. We greatly appreciate responsible disclosure from researchers, developers, and the wider security community.

## Supported Versions

Security fixes are applied to the latest supported release.

If you're running an older version, we recommend upgrading before reporting an issue to ensure it hasn't already been resolved.

## Reporting a Vulnerability

Please **do not** report security vulnerabilities through public GitHub issues.

Instead, report them privately, in either of these ways:

* Email **[mastyf.support@gmail.com](mailto:mastyf.support@gmail.com)**
* Open a [private security advisory](https://github.com/mastyf-ai/mastyf.ai/security/advisories/new) on GitHub (only you and the maintainers can see it)

This includes **bypasses**. If a prompt, payload, path or sequence of tool calls gets past Mastyf's protection in the current release, that is a vulnerability: please don't post it in issues, pull requests or Discussions, even as a test case. Once it's fixed, we'll gladly take a pull request adding it to the attack corpus, with credit to you.

Please include as much information as possible:

* A description of the vulnerability
* Steps to reproduce
* Proof of concept (if available)
* Impact assessment
* Affected version(s)
* Any suggested mitigations or fixes

The more detail you provide, the faster we can investigate.

## What to Expect

After receiving your report, we will:

* Acknowledge receipt as soon as possible.
* Investigate and validate the issue.
* Keep you informed throughout the process.
* Work on a fix where applicable.
* Coordinate responsible disclosure when appropriate.

## Scope

We welcome reports involving, but not limited to:

* Prompt injection bypasses
* Indirect prompt injection
* Jailbreak techniques
* Tool abuse
* Policy bypasses
* Swarm analysis bypasses
* SSRF
* Path traversal
* Shell command injection
* Sensitive data leakage
* Authentication and authorization issues
* Remote code execution
* Privilege escalation
* Sandbox escapes
* Supply chain vulnerabilities
* Denial of service
* Dashboard vulnerabilities
* Dependency vulnerabilities

If you discover a new attack technique that affects AI systems, we'd love to hear about it.

## Out of Scope

The following generally do not qualify as security vulnerabilities:

* Missing security headers
* Self-XSS
* Issues requiring unrealistic user interaction
* Reports without a reproducible proof of concept
* Vulnerabilities in unsupported versions
* Feature requests
* Duplicate reports

## Responsible Disclosure

Please allow us a reasonable amount of time to investigate and remediate reported vulnerabilities before publicly disclosing them.

We believe coordinated disclosure benefits both users and the broader security community.
