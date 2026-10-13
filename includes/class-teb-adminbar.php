<?php
/**
 * FrontEdit top admin-bar Edit / Preview toggle.
 *
 * FrontEdit's real editing entry point is hover/click on blocks; "Preview" mode
 * is toggled via SFE.ModeToggleBar.setInlineUIEnabled(). This exposes the same
 * toggle in the WordPress top admin bar (visible to any user who can edit the
 * current page) and hides FrontEdit's redundant floating mode bar.
 *
 * Ported from the site-level mu-plugin so the whole editing stack is one
 * installable plugin. Disable under Settings → FrontEdit Block Tools.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class TEB_Adminbar {

	public static function init() {
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

	public static function add_toggle_node( $wp_admin_bar ) {
		if ( ! self::can_use() ) {
			return;
		}
		$wp_admin_bar->add_node(
			array(
				'id'    => 'frontedit-toggle',
				'title' => __( 'Preview Page', 'teb-frontedit-block-tools' ),
				'href'  => '#',
				'meta'  => array( 'class' => 'frontedit-adminbar-toggle' ),
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
		?>
		<script>
		(function(){
			var nodeId = 'wp-admin-bar-frontedit-toggle';

			function sfe(){ return (window.MWP && window.MWP.SFE) ? window.MWP.SFE : null; }
			function toggleBar(){ var S = sfe(); return (S && S.ModeToggleBar) ? S.ModeToggleBar : null; }

			// FrontEdit starts in Edit mode on load, so default label is "Preview Page".
			function isEditing(){
				var S = sfe();
				if ( ! S || ! S.Context ) return false;
				return S.Context.isInlineUIEnabled !== false
					&& ! document.body.classList.contains('mwp-sfe-active-preview')
					&& ! document.body.classList.contains('mwp-sfe-preview-mode');
			}

			function updateLabel(){
				var node = document.getElementById(nodeId);
				if ( ! node ) return;
				var link = node.querySelector('a');
				if ( ! link ) return;
				link.textContent = isEditing() ? <?php echo wp_json_encode( __( 'Preview Page', 'teb-frontedit-block-tools' ) ); ?> : <?php echo wp_json_encode( __( 'Edit Page (Frontend)', 'teb-frontedit-block-tools' ) ); ?>;
			}

			function setPreview(on){
				var tb = toggleBar();
				if ( tb && typeof tb.setInlineUIEnabled === 'function' ) {
					tb.setInlineUIEnabled(!on);
				} else {
					var S = sfe();
					if ( ! S ) return;
					S.Context.isInlineUIEnabled = !on;
					document.body.classList.toggle('mwp-sfe-active-preview', on);
					document.body.classList.toggle('mwp-sfe-preview-mode', on);
				}
				updateLabel();
			}

			function onClick(e){
				e.preventDefault();
				if ( isEditing() ) {
					setPreview(true);
				} else {
					setPreview(false);
				}
			}

			function bind(){
				var node = document.getElementById(nodeId);
				if ( ! node ) return;
				var link = node.querySelector('a');
				if ( ! link ) return;
				link.addEventListener('click', onClick);
			}

			// Wait until FrontEdit has initialized (SFE.ModeToggleBar is present).
			function waitForSfe(){
				if ( toggleBar() ) {
					bind();
					updateLabel();
					return;
				}
				setTimeout(waitForSfe, 150);
			}

			if ( document.readyState === 'loading' ) {
				document.addEventListener('DOMContentLoaded', waitForSfe);
			} else {
				waitForSfe();
			}
			window.addEventListener('load', updateLabel);
			document.addEventListener('mwp-sfe-mode-change', updateLabel);
		})();
		</script>
		<?php
	}
}
