<?php
/**
 * Admin surface: settings page + FrontEdit dependency notice.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class TEB_Admin {

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'add_menu' ) );
		add_action( 'admin_init', array( __CLASS__, 'register_settings' ) );
		add_action( 'admin_notices', array( __CLASS__, 'dependency_notice' ) );
	}

	public static function add_menu() {
		add_options_page(
			__( 'FrontEdit Block Tools', 'teb-frontedit-block-tools' ),
			__( 'FrontEdit Block Tools', 'teb-frontedit-block-tools' ),
			'manage_options',
			'teb-settings',
			array( __CLASS__, 'render_page' )
		);
	}

	public static function register_settings() {
		register_setting(
			'teb_settings_group',
			TEB_Settings::OPTION,
			array( 'sanitize_callback' => array( __CLASS__, 'sanitize' ) )
		);
	}

	public static function sanitize( $input ) {
		$out            = TEB_Settings::defaults();
		$out['adminbar_toggle'] = ! empty( $input['adminbar_toggle'] );
		if ( isset( $input['github_repo'] ) ) {
			$repo = preg_replace( '#[^a-zA-Z0-9._/-]#', '', (string) $input['github_repo'] );
			$out['github_repo'] = trim( $repo, '/' );
		}
		return $out;
	}

	public static function render_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$settings = TEB_Settings::all();
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'FrontEdit Block Tools', 'teb-frontedit-block-tools' ); ?></h1>
			<form method="post" action="options.php">
				<?php settings_fields( 'teb_settings_group' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><?php esc_html_e( 'Admin-bar toggle', 'teb-frontedit-block-tools' ); ?></th>
						<td>
							<label>
								<input type="checkbox" name="<?php echo esc_attr( TEB_Settings::OPTION ); ?>[adminbar_toggle]" value="1" <?php checked( ! empty( $settings['adminbar_toggle'] ) ); ?> />
								<?php esc_html_e( 'Show the Edit / Preview toggle in the top admin bar (hides FrontEdit\'s floating mode panel).', 'teb-frontedit-block-tools' ); ?>
							</label>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="teb-github-repo"><?php esc_html_e( 'GitHub repository', 'teb-frontedit-block-tools' ); ?></label></th>
						<td>
							<input id="teb-github-repo" type="text" class="regular-text" name="<?php echo esc_attr( TEB_Settings::OPTION ); ?>[github_repo]" value="<?php echo esc_attr( $settings['github_repo'] ); ?>" />
							<p class="description"><?php esc_html_e( 'owner/repo used by the built-in update checker (GitHub Releases). Leave empty to disable update checks.', 'teb-frontedit-block-tools' ); ?></p>
						</td>
					</tr>
				</table>
				<?php submit_button(); ?>
			</form>
		</div>
		<?php
	}

	/**
	 * Clear, non-blocking notice when the FrontEdit plugin is missing.
	 */
	public static function dependency_notice() {
		if ( ! current_user_can( 'activate_plugins' ) ) {
			return;
		}
		if ( class_exists( 'MWPSFE_Manager' ) || defined( 'MWPSFE_PLUGIN_FILE' ) ) {
			return;
		}
		echo '<div class="notice notice-error"><p><strong>'
			. esc_html__( 'FrontEdit Block Tools', 'teb-frontedit-block-tools' )
			. ':</strong> '
			. esc_html__( 'this plugin needs the FrontEdit plugin (FrontEdit - Live Frontend Block Editor) to be installed and activated. Structural editing will not appear until then.', 'teb-frontedit-block-tools' )
			. ' <a href="https://maintainwp.com/products/frontedit/" target="_blank" rel="noopener">'
			. esc_html__( 'Get FrontEdit', 'teb-frontedit-block-tools' )
			. '</a></p></div>';
	}
}
