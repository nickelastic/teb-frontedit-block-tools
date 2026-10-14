# Changelog

## 1.2.0

* Admin-bar control is now a Preview/Edit slider switch; the chosen mode is stored per user (user meta via the `teb/v1/mode` REST route) and applies to all pages and devices until switched back. Previously every page booted into Edit mode.
* Preview is the default for users who have not chosen a mode (`teb_default_mode` filter).
* Block chip/inserter hides in preview when no editor is open (`mwp-sfe-preview-mode`).

## 1.1.0

* Public reusable release — `teb-` prefix everywhere (slug, `teb_*` functions, `TEB_*` classes/constants, `.teb-*` CSS, `TEB` JS global, text domain `teb-frontedit-block-tools`, REST namespace `teb/v1`).
* Admin-bar Edit/Preview toggle folded into the plugin (setting-gated, default on); site mu-plugin no longer needed.
* Settings page (Settings → FrontEdit Block Tools): admin-bar toggle, watched GitHub repo.
* FrontEdit dependency guard: `Requires Plugins` header + admin notice.
* UI strings localized (`TEB.l10n`, `teb_l10n` filter; French defaults).
* Built-in GitHub Releases updater — native Plugins/Updates screens, one-click update.
* Stock-FrontEdit compatibility: soft-refresh rebind via public `SFE.attachActionBarToElement` (no file patch).
* Edit-mode click-through for embed/video frames so video blocks are selectable/deletable (Preview restores playback).

## 1.0.0

* Initial internal version (gitasaraswati.com): insert/duplicate/delete/reorder, columns, media picker, soft refresh.
