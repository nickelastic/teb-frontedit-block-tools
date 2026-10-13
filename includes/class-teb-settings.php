<?php
/**
 * Shared settings accessors for FrontEdit Block Tools.
 *
 * Settings live in the single `teb_settings` option. Every accessor has a
 * safe default so the plugin works with no saved options at all.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class TEB_Settings {

	const OPTION = 'teb_settings';

	public static function defaults() {
		return array(
			// Show the Edit/Preview toggle in the top admin bar (and hide
			// FrontEdit's redundant floating mode bar).
			'adminbar_toggle' => true,
			// GitHub repo used by the built-in updater ("owner/repo").
			'github_repo'     => 'nickelastic/teb-frontedit-block-tools',
		);
	}

	public static function all() {
		$saved = get_option( self::OPTION, array() );
		if ( ! is_array( $saved ) ) {
			$saved = array();
		}
		return wp_parse_args( $saved, self::defaults() );
	}

	public static function get( $key ) {
		$all = self::all();
		return isset( $all[ $key ] ) ? $all[ $key ] : null;
	}
}
