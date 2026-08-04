{
  description = "reflection.dev -- organization site and documentation hub (11ty)";

  nixConfig = {
    extra-substituters = [ "https://nix-community.cachix.org" ];
    extra-trusted-public-keys = [
      "nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs="
    ];
  };

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs, ... }: let
    systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" "x86_64-darwin" ];
    forEachSystem = nixpkgs.lib.genAttrs systems;
  in {
    devShells = forEachSystem (system: let
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      default = pkgs.mkShell {
        packages = with pkgs; [
          nodejs_22
          pnpm
          git
        ];

        shellHook = ''
          echo "reflection.dev devShell"
          echo "  pnpm install    -- install 11ty and plugins"
          echo "  pnpm sync-docs  -- pull nixops docs into src/docs/nixops"
          echo "  pnpm dev        -- serve with hot reload"
          echo "  pnpm build      -- static build into _site/"
        '';
      };
    });

    formatter = forEachSystem (system: nixpkgs.legacyPackages.${system}.nixfmt-rfc-style);
  };
}
