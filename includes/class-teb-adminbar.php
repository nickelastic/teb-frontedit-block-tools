<?php
/**
 * FrontEdit top admin-bar Preview / Edit slider switch.
 *
 * FrontEdit always boots into Edit mode and has no memory of the editor's
 * choice, so every page opens editable. This exposes a slider switch in the
 * WordPress top admin bar (visible to any user who can edit the current page)
 * and remembers the chosen mode in user meta, so the mode sticks across all
 * pages — and all devices — until the editor flips the switch back.
 *
 * Preview is the default until a user chooses otherwise.
 *
 * Ported from the site-level mu-plugin so the whole editing stack is one
 * installable plugin. Disable under Settings → FrontEdit Block Tools.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class TEB_Adminbar {

	/** User-meta key holding the per-user edit/preview preference. */
	const META_KEY = 'teb_frontedit_mode';

	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
		add_action( 'admin_bar_menu', array( __CLASS__, 'add_toggle_node' ), 100 );
		add_action( 'wp_head', array( __CLASS__, 'hide_floating_bar' ) );
		add_action( 'wp_footer', array( __CLASS__, 'print_toggle_script' ), 20 );
	}

	private static function enabled() {
		return (bool) TEB_Settings::get( 'adminbar_toggle' );
	}

	private static function can_use() {
		return self::enabled() && ! is_admin() && is_singular() && current_user_can( 'edit_post', get_the_ID() );
	}

	/**
	 * The default mode for a user who has never touched the switch.
	 *
	 * Filterable so a site can opt back into opening in Edit mode; Preview is
	 * the default because it keeps the site looking like the published page.
	 */
	public static function default_mode() {
		$mode = apply_filters( 'teb_default_mode', 'preview' );
		return ( 'edit' === $mode ) ? 'edit' : 'preview';
	}

	/**
	 * Resolve the current user's stored mode (falling back to the default).
	 */
	public static function current_mode() {
		$mode = get_user_meta( get_current_user_id(), self::META_KEY, true );
		return ( 'edit' === $mode || 'preview' === $mode ) ? $mode : self::default_mode();
	}

	/**
	 * REST route that persists the chosen mode to user meta.
	 */
	public static function register_routes() {
		register_rest_route(
			'teb/v1',
			'/mode',
			array(
				'methods'             => 'POST',
				'permission_callback' => function () {
					return is_user_logged_in() && current_user_can( 'edit_posts' );
				},
				'callback'            => function ( $request ) {
					$mode = sanitize_key( (string) $request->get_param( 'mode' ) );
					if ( ! in_array( $mode, array( 'edit', 'preview' ), true ) ) {
						return new WP_Error( 'teb_bad_mode', 'Invalid mode', array( 'status' => 400 ) );
					}
					update_user_meta( get_current_user_id(), self::META_KEY, $mode );
					return rest_ensure_response( array( 'success' => true, 'mode' => $mode ) );
				},
			)
		);
	}

	/**
	 * Markup for the slider switch (labels + sliding knob).
	 */
	private static function switch_markup( $mode ) {
		$checked = ( 'edit' === $mode ) ? 'true' : 'false';
		return '<span class="teb-mode-switch" role="switch" aria-checked="' . esc_attr( $checked ) . '">'
			. '<span class="teb-mode-switch-opt teb-mode-switch-preview">' . esc_html__( 'Preview', 'teb-frontedit-block-tools' ) . '</span>'
			. '<span class="teb-mode-switch-knob" aria-hidden="true"></span>'
			. '<span class="teb-mode-switch-opt teb-mode-switch-edit">' . esc_html__( 'Edit', 'teb-frontedit-block-tools' ) . '</span>'
			. '</span>';
	}

	public static function add_toggle_node( $wp_admin_bar ) {
		if ( ! self::can_use() ) {
			return;
		}
		$mode = self::current_mode();
		$wp_admin_bar->add_node(
			array(
				'id'    => 'frontedit-toggle',
				'title' => self::switch_markup( $mode ),
				'href'  => '#',
				'meta'  => array(
					'class' => 'frontedit-adminbar-toggle ' . ( 'edit' === $mode ? 'is-edit' : 'is-preview' ),
					'title' => __( 'Preview / Edit page', 'teb-frontedit-block-tools' ),
				),
			)
		);
	}

	// The floating top-right Edit/Preview panel (mwp-sfe-mode-toggle-bar) is
	// redundant now that we expose the same toggle in the top admin bar.
	public static function hide_floating_bar() {
		if ( ! self::can_use() ) {
			return;
		}
		echo '<style id="frontedit-hide-floating-bar">'
			. '.mwp-sfe-mode-toggle-bar{display:none !important;}'
			. '</style>';
	}

	public static function print_toggle_script() {
		if ( ! self::can_use() ) {
			return;
		}
		$data = array(
			'nodeId'  => 'wp-admin-bar-frontedit-toggle',
			'mode'    => self::current_mode(),
			'restUrl' => esc_url_raw( rest_url( 'teb/v1/mode' ) ),
			'nonce'   => wp_create_nonce( 'wp_rest' ),
		);
		?>
		<script>
		(function(){
			var D = <?php echo wp_json_encode( $data ); ?>;
			var mode = D.mode;

			function sfe(){ return (window.MWP && window.MWP.SFE) ? window.MWP.SFE : null; }
			function toggleBar(){ var S = sfe(); return (S && S.ModeToggleBar) ? S.ModeToggleBar : null; }

			// Push the chosen mode into FrontEdit. Prefers the official public
			// toggle so FrontEdit keeps its own state/overlays in sync; falls
			// back to setting the context flag directly if it hasn't loaded.
			function applyMode(){
				var tb = toggleBar();
				if ( tb && typeof tb.setInlineUIEnabled === 'function' ) {
					tb.setInlineUIEnabled( mode === 'edit' );
					return;
				}
				var S = sfe();
				if ( ! S || ! S.Context ) return;
				var isPreview = ( mode !== 'edit' );
				S.Context.isInlineUIEnabled = ( mode === 'edit' );
				document.body.classList.toggle('mwp-sfe-active-preview', isPreview);
				document.body.classList.toggle('mwp-sfe-preview-mode', isPreview);
			}

			// Reflect the mode in the switch UI (knob position + a11y state).
			function render(){
				var node = document.getElementById(D.nodeId);
				if ( ! node ) return;
				node.classList.toggle('is-edit', mode === 'edit');
				node.classList.toggle('is-preview', mode !== 'edit');
				var sw = node.querySelector('.teb-mode-switch');
				if ( sw ) sw.setAttribute('aria-checked', mode === 'edit' ? 'true' : 'false');
			}

			// Persist the choice to user meta; the UI already updated optimistically.
			function persist(){
				try {
					fetch(D.restUrl, {
						method: 'POST',
						credentials: 'same-origin',
						headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': D.nonce },
						body: JSON.stringify({ mode: mode })
					});
				} catch (_) {}
			}

			function onClick(e){
				e.preventDefault();
				e.stopPropagation();
				mode = ( mode === 'edit' ) ? 'preview' : 'edit';
				render();
				applyMode();
				persist();
			}

			function bind(){
				var node = document.getElementById(D.nodeId);
				if ( ! node || node.getAttribute('data-teb-bound') ) return;
				var link = node.querySelector('a') || node;
				link.addEventListener('click', onClick);
				node.setAttribute('data-teb-bound', '1');
			}

			// FrontEdit may initialize after the admin bar; keep applying until
			// its mode bar exists so the stored mode wins over its Edit default.
			function waitForSfe(){
				if ( toggleBar() ) { applyMode(); bind(); render(); return; }
				setTimeout(waitForSfe, 150);
			}

			function start(){
				bind();
				render();
				applyMode();
				if ( ! toggleBar() ) waitForSfe();
			}

			if ( document.readyState === 'loading' ) {
				document.addEventListener('DOMContentLoaded', start);
			} else {
				start();
			}
		})();
		</script>
		<?php
	}
}
