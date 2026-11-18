# KizamuBeam Packs

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/kizamubeam-logo-dark.png">
    <img src="docs/brand/kizamubeam-logo.png" alt="KizamuBeam" width="520">
  </picture>
</p>

<p align="center">
  <b>Erweiterungspakete (Motive, Pattern, parametrische Vorlagen und Material-Bibliotheken) für KizamuBeam.</b>
</p>

<p align="center">
  <a href="https://github.com/KizamuBeam/kizamubeam">KizamuBeam</a> ·
  <a href="https://github.com/KizamuBeam/kizamubeam-plugins">Plugins</a> ·
  <a href="https://github.com/KizamuBeam/kizamubeam-devices">Geräteprofile</a> ·
  <a href="https://kizamubeam.github.io/kizamubeam/docs/de/">Handbuch</a> ·
  <a href="https://discord.gg/SSr8VHh7EJ">Discord</a> ·
  <a href="README.md">English</a>
</p>

Dieses Repository sammelt `.kzp`-Erweiterungspakete und Quelldateien für [KizamuBeam](https://github.com/KizamuBeam/kizamubeam) – darunter Vektor-**Motive**, **Pattern**, **parametrische Vorlagen** und **Material-Bibliotheken**.

## Aufbau

| Ordner | Zweck |
| --- | --- |
| `packs/` | Installierbare `.kzp`-Erweiterungspakete (`<paket-id>.kzp`) |
| `motifs/` | Vektor-Motive und Grafiken (`category: "motif"`) |
| `patterns/` | Muster und Ornamente (`category: "pattern"` / `"element"`) |
| `templates/` | Parametrische Projektvorlagen |
| `materials/` | Material- und Schnittparameter-Vorlagen |
| `scripts/` | Formatprüfung (`validate.mjs`) |

## Paket installieren

Eine `.kzp`-Datei aus `packs/` (oder den [Releases](https://github.com/KizamuBeam/kizamubeam-packs/releases)) herunterladen und in KizamuBeam über **Datei → Erweiterungspakete … → Aus Datei installieren** laden.

## Eigenes Paket beitragen

1. Die Paketdatei als `<reverse-domain-id>.kzp` (z. B. `org.kizamubeam.example.kzp`) in `packs/` ablegen.
2. Vor einem Pull Request prüfen:
   ```bash
   npm test
   ```

Die vollständige Formatbeschreibung steht in [docs/packs.md](https://github.com/KizamuBeam/kizamubeam/blob/main/docs/packs.md) im Haupt-Repository.

## Lizenz

GPL-3.0-or-later — siehe [LICENSE](LICENSE).
