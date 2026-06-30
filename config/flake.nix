{
  description = "MCP Mastyf AI development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };
      in
      {
        devShells.default = pkgs.mkShell {
          name = "mastyf-ai";

          buildInputs = with pkgs; [
            # Node.js 20 (matches .nvmrc and Dockerfile)
            nodejs_22
            pnpm # use pnpm directly; corepack can't write to nix store

            # Native build toolchain (required for better-sqlite3)
            python3
            gnumake
            gcc

            # Go (for apps/proxy-core)
            go

            # Python for adversarial harness
            (python3.withPackages (ps: with ps; [
              pyyaml
            ]))

            # Optional: local services for development
            redis
            postgresql

            # Useful dev utilities
            curl
            jq
            git
          ];

          shellHook = ''
            echo "MCP Mastyf AI Dev Environment"
            echo "─────────────────────────────────────"
            echo "  Node.js: $(node --version)"
            echo "  pnpm:    $(pnpm --version)"
            echo "  Go:      $(go version)"
            echo "  Python:  $(python3 --version)"
            echo "─────────────────────────────────────"
            echo ""
            echo "Getting started:"
            echo "  pnpm install"
            echo "  pnpm build"
            echo ""

            export PATH="$PWD/node_modules/.bin:$PATH"
          '';

          # Environment variables
          NODE_OPTIONS = "--max-old-space-size=4096";
        };
      }
    );
}
