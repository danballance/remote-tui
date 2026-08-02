{
  description = "Remote Deck development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { nixpkgs, ... }:
    let
      supportedSystems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
    in
    {
      devShells = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
          developmentPackages = with pkgs; [
            fish
            git
            lazygit
            nodejs_24
            pnpm
            tmux
          ];
          welcomeMessage = ''
            echo "Remote Deck development shell"
            echo "Node $(node --version), pnpm $(pnpm --version), $(tmux -V)"
          '';
        in
        {
          default = pkgs.mkShell {
            packages = developmentPackages;

            # Nix always starts an interactive development shell through Bash.
            # Hand it off after Bash has prepared the environment so the
            # project's default shell matches the user's Fish workflow.
            shellHook = welcomeMessage + ''
              if [[ $- == *i* ]]; then
                export SHELL=${pkgs.fish}/bin/fish
                exec ${pkgs.fish}/bin/fish --interactive
              fi
            '';
          };

          # Keep an explicit Bash entry point for troubleshooting and for
          # contributors who prefer it.
          bash = pkgs.mkShell {
            packages = developmentPackages;
            shellHook = welcomeMessage;
          };
        });
    };
}
