=== TEB FrontEdit Block Tools ===
Contributors: nickelastic
Tags: frontedit, block editor, frontend editing, gutenberg
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Requires Plugins: frontedit-live-block-editor
Stable tag: 1.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Extends FrontEdit with structural block operations: insert (type picker), duplicate, delete, drag-reorder, columns, and media insert — all keyed off FrontEdit UUIDs.

== Description ==

TEB FrontEdit Block Tools turns the [FrontEdit](https://maintainwp.com/products/frontedit/) live frontend editor into a full Wix-like editing experience:

* **Insert blocks** from a per-block `+` chip with a type picker (paragraph, heading, list, button, image, video, columns, spacer, HTML).
* **Duplicate / delete** the active block (with confirmation).
* **Drag to reorder** blocks via a left-edge handle (pointer-events based, works headless).
* **Responsive columns** (2–4, equal or preset layouts) and **insert inside columns**.
* **Image insert** from the Media Library or upload, in a self-contained picker modal.
* **Soft refresh** — after every structural change the affected blocks re-render in place via FrontEdit's own server-rendered HTML; no page reload, the editor stays mounted.
* **Admin-bar Edit/Preview toggle** (optional, on by default) replacing FrontEdit's floating mode panel.
* **Automatic update notices** from this plugin's GitHub Releases, right on the Plugins / Updates screens.

Requires the FrontEdit plugin (commercial, by MaintainWP) to be installed separately. Works for any role that can `edit_post` the current post. French UI by default; override any string via the `teb_l10n` filter.

== Installation ==

1. Install and activate [FrontEdit](https://maintainwp.com/products/frontedit/).
2. Upload this plugin (Plugins → Add New → Upload Plugin) and activate.
3. Open any page on the frontend while logged in — the block chip appears on click.

== Updating ==

New versions are detected from GitHub Releases automatically (Settings → FrontEdit Block Tools sets the watched repository). Updates install with one click from Dashboard → Updates or the Plugins screen. For private forks, define `SFEBT_GITHUB_TOKEN` (read-only PAT) in wp-config.php to avoid anonymous API rate limits.

== Frequently Asked Questions ==

= The chip does not appear on a block =

Make sure FrontEdit is active and you are logged in with permission to edit the post, and that you are not in Preview mode (admin-bar toggle).

= Can I change the UI language? =

Yes — hook `teb_l10n` and override any of the 55 string keys, or contribute a translation for the `teb-frontedit-block-tools` text domain.

== Changelog ==

= 1.1.0 =
* Public reusable release: TEB prefix throughout (slug, functions, classes, CSS, JS, text domain, REST namespace `teb/v1`).
* Folded the admin-bar Edit/Preview toggle into the plugin (Settings → FrontEdit Block Tools, on by default).
* Settings page + clear admin notice when FrontEdit is not active.
* Localized UI strings (`TEB.l10n`, `teb_l10n` filter).
* Built-in GitHub Releases updater (native WP update UI).
* Works with a stock, unpatched FrontEdit (rebinds via the public `SFE.attachActionBarToElement` API).
* Embed/video frames are click-through in edit mode so YouTube blocks can be selected, deleted, duplicated; Preview mode restores playback.

= 1.0.0 =
* Initial internal version (used on gitasaraswati.com).
