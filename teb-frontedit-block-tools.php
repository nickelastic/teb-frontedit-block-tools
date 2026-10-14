<?php
/**
 * Plugin Name:       TEB FrontEdit Block Tools
 * Plugin URI:        https://github.com/nickelastic/teb-frontedit-block-tools
 * Description:       Extends FrontEdit with structural block operations (insert with type picker, duplicate, delete) keyed off FrontEdit UUIDs.
 * Version:           1.2.0
 * Author:            Nick Elastic
 * Author URI:        https://github.com/nickelastic
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       teb-frontedit-block-tools
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Requires Plugins:  frontedit-live-block-editor
 * GitHub Plugin URI: https://github.com/nickelastic/teb-frontedit-block-tools
 *
 * Extends FrontEdit with structural block operations that the inline editor
 * itself does not provide: insert (with block-type picker), duplicate, and
 * delete — all keyed off the mwpSfeUuid FrontEdit stamps on every block.
 *
 * It registers its own REST routes under the teb/v1 namespace (reusing the
 * wp_rest nonce) and a small frontend inserter UI that appears while FrontEdit
 * is in edit mode. After any structural change the affected blocks are
 * re-rendered in place (soft refresh via FrontEdit's own server-rendered HTML)
 * so the editor stays mounted and no full reload occurs.
 *
 * Requires the FrontEdit plugin (https://maintainwp.com/products/frontedit/).
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'TEB_VERSION', '1.2.0' );
define( 'TEB_PLUGIN_FILE', __FILE__ );
define( 'TEB_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'TEB_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

require_once TEB_PLUGIN_DIR . 'includes/teb-blocks.php';
require_once TEB_PLUGIN_DIR . 'includes/class-teb-settings.php';
require_once TEB_PLUGIN_DIR . 'includes/class-teb-adminbar.php';
require_once TEB_PLUGIN_DIR . 'includes/class-teb-admin.php';
require_once TEB_PLUGIN_DIR . 'includes/class-teb-updater.php';

add_action( 'rest_api_init', 'teb_register_routes' );
add_action( 'wp_enqueue_scripts', 'teb_enqueue_assets' );
// Bake FrontEdit UUIDs into the post content on load (before FrontEdit renders)
// so that blocks carry stable mwpSfeUuid attributes in post_content. Without this,
// a post that has never been saved through FrontEdit's UUID path has no uuids in
// its content, so the DOM uuids FrontEdit generates at runtime don't match what
// our structural actions look up by uuid — causing duplicate/delete/reorder to fail
// with "Block not found". Idempotent: only writes when uuids are missing.
add_action( 'wp', 'teb_ensure_uuids_on_view' );

TEB_Adminbar::init();
TEB_Admin::init();
TEB_Updater::init();

/**
 * Frontend UI strings. French is the built-in default (the primary audience);
 * projects in other languages can override any key via the `teb_l10n` filter
 * or ship a translation for the `teb-frontedit-block-tools` text domain.
 */
function teb_l10n_strings() {
	$strings = array(
		'saving'            => 'Enregistrement…',
		'errorTitle'        => 'Erreur',
		'errorAction'       => 'Action échouée.',
		'errorNetworkTitle' => 'Erreur réseau',
		'errorNetwork'      => 'Impossible de contacter le serveur. Vérifiez votre connexion et réessayez.',
		'addBlock'          => 'Ajouter un bloc',
		'duplicate'         => 'Dupliquer',
		'delete'            => 'Supprimer',
		'dupProgress'       => 'Duplication du bloc…',
		'delProgress'       => 'Suppression du bloc…',
		'delConfirmTitle'   => 'Supprimer le bloc',
		'delConfirmBody'    => 'Voulez-vous vraiment supprimer ce bloc ? Cette action est irréversible.',
		'confirm'           => 'Confirmer',
		'cancel'            => 'Annuler',
		'moveHandle'        => 'Déplacer (glisser) — le réordonnancement à l\'intérieur d\'une colonne n\'est pas encore supporté',
		'reorderProgress'   => 'Réorganisation du bloc…',
		'chooseImage'       => 'Choisir une image',
		'close'             => 'Fermer',
		'library'           => 'Bibliothèque',
		'upload'            => 'Téléverser',
		'search'            => 'Rechercher…',
		'loading'           => 'Chargement…',
		'insertImage'       => 'Insérer l\'image',
		'noMedia'           => 'Aucun média trouvé.',
		'libraryLoadFail'   => 'Échec du chargement de la bibliothèque.',
		'uploading'         => 'Téléversement…',
		'uploaded'          => 'Image téléversée.',
		'uploadFail'        => 'Échec du téléversement: ',
		'addImageProgress'  => 'Ajout d\'une image…',
		'addVideoProgress'  => 'Ajout de vidéo…',
		'addBlockProgress'  => 'Ajout d\'un bloc…',
		'addColumnProgress' => 'Ajout de colonnes…',
		'videoPrompt'       => 'URL de la vidéo (YouTube, Vimeo, ou direct) :',
		'colCountLabel'     => 'Nombre de colonnes :',
		'layoutsLabel'      => 'Layouts :',
		'colEq2'            => '2 colonnes égales',
		'colEq3'            => '3 colonnes égales',
		'colEq4'            => '4 colonnes égales',
		'layout2_13_23'     => '2 colonnes 1/3 - 2/3',
		'layout2_23_13'     => '2 colonnes 2/3 - 1/3',
		'layout2_14_34'     => '2 colonnes 1/4 - 3/4',
		'layout2_34_14'     => '2 colonnes 3/4 - 1/4',
		'layout3_121'       => '3 colonnes 1/4 - 1/2 - 1/4',
		'undoTitle'         => 'Annuler (version précédente)',
		'redoTitle'         => 'Rétablir (version suivante)',
		'versions'          => 'Versions',
		'typeParagraph'     => 'Paragraphe',
		'typeHeading'       => 'Titre',
		'typeList'          => 'Liste',
		'typeButton'        => 'Bouton',
		'typeImage'         => 'Image',
		'typeVideo'         => 'Vidéo',
		'typeColumns'       => 'Colonnes',
		'typeSpacer'        => 'Espace',
		'typeHtml'          => 'HTML',
	);
	return apply_filters( 'teb_l10n', $strings );
}

function teb_enqueue_assets() {
	if ( is_admin() || ! is_singular() || ! is_user_logged_in() || ! current_user_can( 'edit_post', get_the_ID() ) ) {
		return;
	}
	wp_enqueue_style( 'teb-style', TEB_PLUGIN_URL . 'assets/block-tools.css', array(), TEB_VERSION . '.' . filemtime( TEB_PLUGIN_DIR . 'assets/block-tools.css' ) );
	wp_enqueue_script( 'teb-script', TEB_PLUGIN_URL . 'assets/block-tools.js', array(), TEB_VERSION . '.' . filemtime( TEB_PLUGIN_DIR . 'assets/block-tools.js' ), true );
	wp_localize_script(
		'teb-script',
		'TEB',
		array(
			'restUrl'  => esc_url_raw( rest_url( 'teb/v1/block-action' ) ),
			'restBase' => esc_url_raw( rest_url() ),
			'nonce'    => wp_create_nonce( 'wp_rest' ),
			'postId'   => get_the_ID(),
			'l10n'     => teb_l10n_strings(),
		)
	);
}
