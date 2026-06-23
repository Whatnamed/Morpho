# Morpho

Morpho is an AI-assisted concept-development workspace for product and industrial designers.

It brings research materials, design definition, concept directions, image development, project context, and delivery preparation into one continuous canvas-based project space.

## Current status

Active development.

The project currently has confirmed product rules, UI behavior specifications, a light-mode design system, and a visual workspace anchor. The application architecture and production implementation are being established in this repository.

## What Morpho is for

* Start from a sentence, image, file, link, sketch, or existing design material
* Organize research and candidate analysis on a continuous canvas
* Preserve key conclusions and apply a current design definition
* Develop concept directions and images without rigid stage gates
* Continue, modify, compare, derive, and reference visual work
* Prepare delivery content without replacing professional layout tools
* Preserve project relationships, versions, decisions, and reusable context

## What Morpho is not

* A generic project-management dashboard
* A node workflow editor
* A Figma, PPT, CAD, engineering, BOM, or PLM replacement
* A model-control console
* A mandatory linear six-step process

## Documentation map

### Product rules

* [`docs/product/`](docs/product/) — current product definition and behavior rules
* Start with [`README_本次更新说明.md`](docs/product/README_本次更新说明.md)
* `00–05` define rule precedence, product flow, canvas objects, AI behavior, state and memory, and project assets / import / archive

### Design rules

* [`docs/design/Morpho_UI_原型设计说明_v1.md`](docs/design/Morpho_UI_原型设计说明_v1.md)
* [`docs/design/Morpho_Light_Design_System_v1_CN_EN.md`](docs/design/Morpho_Light_Design_System_v1_CN_EN.md)
* [`docs/design/references/morpho_workspace_anchor_v2.html`](docs/design/references/morpho_workspace_anchor_v2.html)

### Engineering documentation

* [`docs/architecture/`](docs/architecture/) — current implementation architecture and confirmed technical decisions
* [`docs/operations/`](docs/operations/) — actual setup, run, test, build, and deployment instructions

## Development

Development commands will be added to `docs/operations/runbook.md` after the application scaffold and runtime are established.

## Project instructions

All coding agents must read [`AGENTS.md`](AGENTS.md) before changing the repository.

For Claude Code, [`CLAUDE.md`](CLAUDE.md) imports the same shared instructions.

## Demo project

The official demo project is:

> 夜航 / Nightrail
> 为独居老人的夜间起身与卫浴路径设计一套低施工、非医疗化的连续辅助系统。

Do not treat historical prototype content such as `Nightfield`, “安静的仪器”, or compact tactical-light concepts as official Morpho product content.
