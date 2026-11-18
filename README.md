# KizamuBeam Packs

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/kizamubeam-logo-dark.png">
    <img src="docs/brand/kizamubeam-logo.png" alt="KizamuBeam" width="520">
  </picture>
</p>

<p align="center">
  <b>Extension packs (motifs, patterns, parametric templates, and material libraries) for KizamuBeam.</b>
</p>

<p align="center">
  <a href="https://github.com/KizamuBeam/kizamubeam">KizamuBeam</a> ·
  <a href="https://github.com/KizamuBeam/kizamubeam-plugins">Plugins</a> ·
  <a href="https://github.com/KizamuBeam/kizamubeam-devices">Device Profiles</a> ·
  <a href="https://kizamubeam.github.io/kizamubeam/docs/">Manual</a> ·
  <a href="https://discord.gg/SSr8VHh7EJ">Discord</a> ·
  <a href="README.de.md">Deutsch</a>
</p>

This repository hosts `.kzp` extension packs and source assets for [KizamuBeam](https://github.com/KizamuBeam/kizamubeam) — including vector **motifs**, **patterns**, **parametric templates**, and **material libraries**.

## Repository Structure

| Folder | Purpose |
| --- | --- |
| `packs/` | Ready-to-install `.kzp` extension packs (`<pack-id>.kzp`) |
| `motifs/` | Vector motifs and artwork (`category: "motif"`) |
| `patterns/` | Seamless and decorative patterns (`category: "pattern"` / `"element"`) |
| `templates/` | Parametric project templates |
| `materials/` | Material and cut-setting presets |
| `scripts/` | Format validation (`validate.mjs`) |

## Installing a Pack

Download any `.kzp` file from `packs/` (or [Releases](https://github.com/KizamuBeam/kizamubeam-packs/releases)) and open it in KizamuBeam via **File → Extension Packs … → Install from file**.

## Contributing a Pack

1. Name your pack file `<reverse-domain-id>.kzp` (e.g. `org.kizamubeam.example.kzp`) inside `packs/`.
2. Validate all packs before opening a pull request:
   ```bash
   npm test
   ```

For the full `.kzp` format specification, see [docs/packs.md](https://github.com/KizamuBeam/kizamubeam/blob/main/docs/packs.md) in the main repository.

## License

GPL-3.0-or-later — see [LICENSE](LICENSE).
