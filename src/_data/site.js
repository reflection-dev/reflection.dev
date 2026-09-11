export default {
  name: "Reflection",
  domain: "reflection.dev",
  url: "https://reflection.dev",
  org: "reflection-dev",
  github: "https://github.com/reflection-dev",
  tagline: "The open framework for AI-native companies.",
  projects: [
    {
      slug: "zeno",
      name: "zeno",
      role: "Orchestration",
      tagline:
        "An always-on orchestrator for ephemeral agents — company processes in Lisp, every agent boxed behind its own MCP.",
      repo: "https://github.com/reflection-dev/zeno",
      docs: "/docs/zeno/",
    },
    {
      slug: "nixops",
      name: "nixops",
      role: "Infrastructure",
      tagline:
        "Generic NixOS fleet base — inventory-driven modules, deploy-rs and sops-nix wiring, nixos-anywhere bootstrap.",
      repo: "https://github.com/reflection-dev/nixops",
      docs: "/docs/nixops/",
    },
  ],
};
