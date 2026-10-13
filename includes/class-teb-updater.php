<?php
/**
 * Built-in GitHub Releases update checker.
 *
 * Watches the plugin's GitHub repository for new releases and registers them
 * with WordPress's own update machinery, so new versions show up on the
 * Plugins page and Dashboard → Updates with one-click "Update now" — no extra
 * updater plugin required.
 *
 * The release should attach a zip whose root contains the plugin folder
 * (e.g. `teb-frontedit-block-tools/teb-frontedit-block-tools.php`); the release tag
 * (leading `v` stripped) is compared against the plugin's Version header.
 *
 * Configure the repository under Settings → FrontEdit Block Tools, or define
 * TEB_GITHUB_TOKEN (a read-only PAT) if you hit GitHub's anonymous API
 * rate limits (60 requests/hour per IP).
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class TEB_Updater {

	const TRANSIENT = 'teb_updater_check';

	public static function init() {
		$repo = (string) TEB_Settings::get( 'github_repo' );
		if ( '' === $repo || false !== strpos( $repo, '://' ) ) {
			return; // disabled or misconfigured
		}
		$instance = new self( $repo );
		add_filter( 'pre_set_site_transient_update_plugins', array( $instance, 'check_for_update' ) );
	}

	private $repo;
	private $slug;

	public function __construct( $repo ) {
		$this->repo = $repo;
		$this->slug = plugin_basename( TEB_PLUGIN_FILE );
	}

	public function check_for_update( $transient ) {
		if ( empty( $transient->checked ) || empty( $transient->checked[ $this->slug ] ) ) {
			return $transient;
		}
		$release = $this->fetch_latest_release();
		if ( empty( $release['version'] ) ) {
			return $transient;
		}
		if ( ! version_compare( $release['version'], TEB_VERSION, '>' ) ) {
			return $transient;
		}
		$transient->response[ $this->slug ] = (object) array(
			'id'         => 'teb/' . $this->repo,
			'slug'       => dirname( $this->slug ) ? dirname( $this->slug ) : $this->slug,
			'plugin'     => $this->slug,
			'new_version' => $release['version'],
			'url'        => 'https://github.com/' . $this->repo,
			'package'    => $release['package'],
		);
		return $transient;
	}

	/**
	 * Fetch /releases/latest, cached for 12 hours. Returns
	 * array( 'version' => '', 'package' => '' ) on any failure.
	 */
	private function fetch_latest_release() {
		$cached = get_transient( self::TRANSIENT );
		if ( is_array( $cached ) ) {
			return $cached;
		}
		$result = array(
			'version' => '',
			'package' => '',
		);
		$url  = 'https://api.github.com/repos/' . $this->repo . '/releases/latest';
		$args = array(
			'timeout'    => 15,
			'user-agent' => 'WordPress/' . get_bloginfo( 'version' ) . '; ' . home_url(),
			'headers'    => array( 'Accept' => 'application/vnd.github+json' ),
		);
		if ( defined( 'TEB_GITHUB_TOKEN' ) && TEB_GITHUB_TOKEN ) {
			$args['headers']['Authorization'] = 'Bearer ' . TEB_GITHUB_TOKEN;
		}
		$res = wp_remote_get( $url, $args );
		if ( is_wp_error( $res ) || 200 !== wp_remote_retrieve_response_code( $res ) ) {
			// Negative-cache briefly so a down API doesn't hammer on every admin load.
			set_transient( self::TRANSIENT, $result, HOUR_IN_SECONDS );
			return $result;
		}
		$data = json_decode( wp_remote_retrieve_body( $res ), true );
		if ( ! is_array( $data ) || empty( $data['tag_name'] ) ) {
			set_transient( self::TRANSIENT, $result, HOUR_IN_SECONDS );
			return $result;
		}
		$result['version'] = ltrim( (string) $data['tag_name'], 'v' );
		// Prefer an attached plugin zip; fall back to the source zipball.
		if ( ! empty( $data['assets'] ) && is_array( $data['assets'] ) ) {
			foreach ( $data['assets'] as $asset ) {
				$name = isset( $asset['name'] ) ? (string) $asset['name'] : '';
				if ( preg_match( '/teb-frontedit-block-tools.*\.zip$/i', $name ) && ! empty( $asset['browser_download_url'] ) ) {
					$result['package'] = $asset['browser_download_url'];
					break;
				}
			}
		}
		if ( '' === $result['package'] && ! empty( $data['zipball_url'] ) ) {
			$result['package'] = $data['zipball_url'];
		}
		set_transient( self::TRANSIENT, $result, 12 * HOUR_IN_SECONDS );
		return $result;
	}
}
