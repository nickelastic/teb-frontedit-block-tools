<?php
// Block engine: UUID baking, block construction, structural REST routes.
if ( ! defined( 'ABSPATH' ) ) { exit; }

function teb_ensure_uuids_on_view() {
	if ( is_admin() || ! is_singular() || ! is_user_logged_in() ) {
		return;
	}
	$post = get_queried_object();
	if ( ! $post instanceof WP_Post || empty( $post->post_content ) ) {
		return;
	}
	if ( ! current_user_can( 'edit_post', $post->ID ) ) {
		return;
	}
	// Already has uuids baked in — nothing to do.
	if ( false !== strpos( $post->post_content, 'mwpSfeUuid' ) ) {
		return;
	}
	if ( class_exists( 'MWPSFE_UUID_Manager' ) ) {
		$manager = MWPSFE_UUID_Manager::instance();
		if ( method_exists( $manager, 'ensure_uuids_for_post' ) ) {
			try {
				$manager->ensure_uuids_for_post( $post );
			} catch ( \Throwable $e ) {
				// Baking is best-effort.
			}
		}
	}
}

/**
 * Generate a fresh mwpSfeUuid in the same shape FrontEdit uses.
 */
function teb_new_uuid( $post_id, $type ) {
	$chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	$suffix = '';
	for ( $i = 0; $i < 16; $i ++ ) {
		$suffix .= $chars[ wp_rand( 0, strlen( $chars ) - 1 ) ];
	}
	return $post_id . '-' . $type . '-' . $suffix;
}

/**
 * Build a new block array from an requested type + payload.
 */
function teb_build_block( $post_id, $type, $payload ) {
	$uuid = teb_new_uuid( $post_id, $type );
	switch ( $type ) {
		case 'heading':
			$level = (int) ( $payload['level'] ?? 2 );
			$text  = $payload['text'] ?? 'Titre';
			return array(
				'blockName'    => 'core/heading',
				'attrs'        => array( 'level' => $level, 'mwpSfeUuid' => $uuid, 'mwpSfeUuidShadow' => $uuid ),
				'innerBlocks'  => array(),
				'innerHTML'    => '<h' . $level . ' class="wp-block-heading">' . esc_html( $text ) . '</h' . $level . '>',
				'innerContent' => array( '<h' . $level . ' class="wp-block-heading">' . esc_html( $text ) . '</h' . $level . '>' ),
			);
		case 'paragraph':
			$text = $payload['text'] ?? 'Nouveau paragraphe';
			return array(
				'blockName'    => 'core/paragraph',
				'attrs'        => array( 'mwpSfeUuid' => $uuid, 'mwpSfeUuidShadow' => $uuid ),
				'innerBlocks'  => array(),
				'innerHTML'    => '<p>' . esc_html( $text ) . '</p>',
				'innerContent' => array( '<p>' . esc_html( $text ) . '</p>' ),
			);
		case 'list':
			return array(
				'blockName'    => 'core/list',
				'attrs'        => array( 'mwpSfeUuid' => $uuid, 'mwpSfeUuidShadow' => $uuid ),
				'innerBlocks'  => array(),
				'innerHTML'    => '<ul class="wp-block-list"><li>Élément de liste</li></ul>',
				'innerContent' => array( '<ul class="wp-block-list"><li>Élément de liste</li></ul>' ),
			);
		case 'button':
			$label = $payload['text'] ?? 'Bouton';
			$url   = $payload['url'] ?? '#';
			$inner = '<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="' . esc_url( $url ) . '">' . esc_html( $label ) . '</a></div>';
			return array(
				'blockName'    => 'core/button',
				'attrs'        => array( 'mwpSfeUuid' => $uuid, 'mwpSfeUuidShadow' => $uuid ),
				'innerBlocks'  => array(),
				'innerHTML'    => $inner,
				'innerContent' => array( $inner ),
			);
		case 'spacer':
			$inner = '<div style="height:40px" aria-hidden="true" class="wp-block-spacer"></div>';
			return array(
				'blockName'    => 'core/spacer',
				'attrs'        => array( 'height' => '40px', 'mwpSfeUuid' => $uuid, 'mwpSfeUuidShadow' => $uuid ),
				'innerBlocks'  => array(),
				'innerHTML'    => $inner,
				'innerContent' => array( $inner ),
			);
		case 'html':
			$inner = 'Texte ou code HTML ici.';
			return array(
				'blockName'    => 'core/html',
				'attrs'        => array( 'mwpSfeUuid' => $uuid, 'mwpSfeUuidShadow' => $uuid ),
				'innerBlocks'  => array(),
				'innerHTML'    => $inner,
				'innerContent' => array( $inner ),
			);
		case 'video':
			// Support YouTube/Vimeo URLs and direct video URLs.
			$src     = isset( $payload['url'] ) ? esc_url_raw( $payload['url'] ) : '';
			$caption = isset( $payload['caption'] ) ? sanitize_text_field( $payload['caption'] ) : '';

			// YouTube/Vimeo are core/embed blocks. core's save() stores the bare URL
			// inside .wp-block-embed__wrapper and core/embed is server-rendered, so
			// render_block_core_embed() swaps the URL for the provider iframe at
			// output time. Storing a hardcoded <iframe> here does NOT render wrong -
			// it makes the block fail validation, because save() never emits an
			// iframe, and the editor then reports invalid or unexpected content.
			$provider = '';
			$video_id = '';
			if ( $src && preg_match( '#(?:youtube\.com/watch\?v=|youtu\.be/)([a-zA-Z0-9_-]+)#', $src, $yt ) ) {
				$provider = 'youtube';
				$video_id = $yt[1];
			} elseif ( $src && preg_match( '#vimeo\.com/(\d+)#', $src, $vm ) ) {
				$provider = 'vimeo';
				$video_id = $vm[1];
			}

			if ( $provider ) {
				$figure_class = 'wp-block-embed is-type-video is-provider-' . $provider . ' wp-block-embed-' . $provider;
				$inner        = '<figure class="' . $figure_class . '"><div class="wp-block-embed__wrapper">' . $src . '</div></figure>';
				return array(
					'blockName'    => 'core/embed',
					'attrs'        => array(
						'url'              => $src,
						'type'             => 'video',
						'providerNameSlug' => $provider,
						'responsive'       => true,
						'mwpSfeUuid'       => $uuid,
						'mwpSfeUuidShadow' => $uuid,
					),
					'innerBlocks'  => array(),
					'innerHTML'    => $inner,
					'innerContent' => array( $inner ),
				);
			}

			if ( $src ) {
				$inner = '<figure class="wp-block-video"><video controls src="' . esc_url( $src ) . '"></video>';
				if ( $caption ) {
					// core/figcaption carries the shared element class
					// wp-element-caption, not the never-generated block-style
					// name wp-block-video__caption.
					$inner .= '<figcaption class="wp-element-caption">' . esc_html( $caption ) . '</figcaption>';
				}
				$inner .= '</figure>';
			} else {
				$inner = '<figure class="wp-block-video"><video controls></video></figure>';
			}
			return array(
				'blockName'    => 'core/video',
				'attrs'        => array( 'src' => $src, 'mwpSfeUuid' => $uuid, 'mwpSfeUuidShadow' => $uuid ),
				'innerBlocks'  => array(),
				'innerHTML'    => $inner,
				'innerContent' => array( $inner ),
			);
		case 'image':
			// When a real photo was chosen (library pick or upload) the payload
			// carries url/id/alt, so build a real <figure><img> that renders with
			// the selected image and a FrontEdit UUID. Fall back to a transparent
			// placeholder only if no URL was supplied.
			$img_url = isset( $payload['url'] ) ? esc_url_raw( $payload['url'] ) : '';
			$img_id  = isset( $payload['id'] ) ? (int) $payload['id'] : 0;
			$img_alt = isset( $payload['alt'] ) ? sanitize_text_field( $payload['alt'] ) : '';
			if ( $img_url ) {
				// core only emits the wp-image-{id} class when the id is truthy,
				// so a missing/zero id must not produce wp-image-0.
				$img_class = $img_id ? ' class="wp-image-' . $img_id . '"' : '';
				$inner     = '<figure class="wp-block-image"><img' . $img_class . ' src="' . $img_url . '" alt="' . $img_alt . '"></figure>';
			} else {
				$placeholder = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
				$inner       = '<figure class="wp-block-image"><img src="' . $placeholder . '" alt="Cliquer pour choisir une image"></figure>';
			}
			return array(
				'blockName'    => 'core/image',
				'attrs'        => array( 'id' => $img_id, 'mwpSfeUuid' => $uuid, 'mwpSfeUuidShadow' => $uuid ),
				'innerBlocks'  => array(),
				'innerHTML'    => $inner,
				'innerContent' => array( $inner ),
			);
		case 'columns':
			// Responsive columns: a core/columns wrapper holding $count core/column
			// children. CSS (see block-tools.css) stacks them to a single column
			// under ~782px so the layout stays readable on phones.
			$count  = isset( $payload['count'] ) ? (int) $payload['count'] : 2;
			$count  = max( 2, min( 4, $count ) );
			// Optional width array: e.g. ["50%","25%","25%"] for a sidebar layout.
			$widths = isset( $payload['widths'] ) && is_array( $payload['widths'] )
				? array_map( 'strval', $payload['widths'] )
				: array();
			$columns = array();
			for ( $i = 0; $i < $count; $i ++ ) {
				$width     = ( isset( $widths[ $i ] ) && '' !== $widths[ $i ] ) ? $widths[ $i ] : '';
				// One UUID per column, reused for the shadow copy - generating two
				// made the shadow disagree with the primary and FrontEdit then
				// could not tell which key the block was filed under.
				$col_uuid  = teb_new_uuid( $post_id, 'column' );
				$col_attrs = array(
					'mwpSfeUuid'       => $col_uuid,
					'mwpSfeUuidShadow' => $col_uuid,
				);
				if ( $width ) {
					$col_attrs['width'] = $width;
				}
				// The saved innerHTML must carry the flex-basis style or WordPress's
				// serialize_blocks will drop the width when round-tripping through
				// parse_blocks/serialize_blocks (core/column width is stored both in
				// attrs and rendered as style on the wrapper).
				$col_style = $width ? ' style="flex-basis:' . esc_attr( $width ) . '"' : '';
				$col_html  = '<div class="wp-block-column"' . $col_style . '></div>';
				$columns[] = array(
					'blockName'    => 'core/column',
					'attrs'        => $col_attrs,
					'innerBlocks'  => array(),
					'innerHTML'    => $col_html,
					'innerContent' => array( $col_html ),
				);
			}
			// innerContent must interleave the wrapper's open/close tags with a
			// placeholder for each nested core/column block, otherwise serialize_blocks
			// emits the columns as bare <div>s (with no wp:column comment / uuid) and
			// they become unselectable and untargetable.
			$inner_content   = array( '<div class="wp-block-columns">' );
			$inner_html      = '<div class="wp-block-columns">';
			foreach ( $columns as $col ) {
				$inner_content[] = $col;
				$inner_html     .= $col['innerHTML'];
			}
			$inner_content[] = '</div>';
			$inner_html     .= '</div>';
			return array(
				'blockName'    => 'core/columns',
				'attrs'        => array( 'mwpSfeUuid' => $uuid, 'mwpSfeUuidShadow' => $uuid ),
				'innerBlocks'  => $columns,
				'innerHTML'    => $inner_html,
				'innerContent' => $inner_content,
			);
		default:
			return null;
	}
}

/**
 * Extract a serialized block from raw post content by its UUID.
 * Returns the full serialized form (comment + innerHTML + closing comment).
 * Returns empty string if not found.
 */
function teb_extract_serialized_block( $content, $uuid ) {
	// Find the UUID position in the raw content.
	$uuid_pos = strpos( $content, '"' . $uuid . '"' );
	if ( false === $uuid_pos ) {
		return '';
	}
	// Scan backwards from the UUID to find the block opener: <!-- wp:TAG ...
	$before = substr( $content, 0, $uuid_pos );
	$opener_pos = strrpos( $before, '<!-- wp:' );
	if ( false === $opener_pos ) {
		return '';
	}
	// Extract the tag name from the opener.
	$opener_line = substr( $content, $opener_pos, strpos( $content, "\n", $opener_pos ) - $opener_pos );
	if ( preg_match( '/<!-- wp:([a-z0-9\/-]+)/', $opener_line, $tm ) ) {
		$tag = $tm[1];
	} else {
		return '';
	}
	// Scan forward from the opener to find the matching closing comment: <!-- /wp:TAG -->
	$close_pattern = '/<!-- \\/wp:' . preg_quote( $tag, '/' ) . ' -->/';
	if ( preg_match( $close_pattern, $content, $cm, PREG_OFFSET_CAPTURE, $opener_pos ) ) {
		$end = $cm[0][1] + strlen( $cm[0][0] );
		return substr( $content, $opener_pos, $end - $opener_pos );
	}
	return '';
}

/**
 * Remove a serialized block from raw post content by its UUID.
 * Returns the modified content, or the original if not found.
 */
function teb_remove_serialized_block( $content, $uuid ) {
	$block = teb_extract_serialized_block( $content, $uuid );
	if ( '' === $block ) {
		return $content;
	}
	return str_replace( $block, '', $content );
}

/**
 * Normalize a block's HTML and attributes to match WordPress save() output.
 * Recurses into innerBlocks. Fixes legacy paragraphs with wp-block-paragraph
 * class and inline font-size not reflected in attrs.
 */
function teb_normalize_block( &$block ) {
	// Recurse into children first.
	if ( ! empty( $block['innerBlocks'] ) ) {
		foreach ( $block['innerBlocks'] as &$child ) {
			teb_normalize_block( $child );
		}
		unset( $child );
	}

	// Only normalize core/paragraph for now.
	if ( 'core/paragraph' !== ( $block['blockName'] ?? '' ) ) {
		return;
	}

	$attrs = &$block['attrs'];
	$html  = $block['innerHTML'] ?? '';
	$changed = false;

	// 1. Remove wp-block-paragraph class (not in WP save() output — className:false).
	if ( false !== strpos( $html, 'wp-block-paragraph' ) ) {
		$html = str_replace( ' wp-block-paragraph', '', $html );
		$html = preg_replace( '/<p\s+class="wp-block-paragraph"/', '<p', $html );
		$html = preg_replace( '/<p\s+/', '<p ', $html ); // clean up double spaces
		$changed = true;
	}

	// 2. Parse inline font-size and move to attrs['style']['typography'].
	if ( preg_match( '/style="[^"]*font-size:\s*([^;"]+)/', $html, $fs_match ) ) {
		$fs_value = trim( $fs_match[1] );
		// Only add to attrs if not already there.
		if ( empty( $attrs['style']['typography']['fontSize'] ) ) {
			if ( ! isset( $attrs['style'] ) ) {
				$attrs['style'] = array();
			}
			if ( ! isset( $attrs['style']['typography'] ) ) {
				$attrs['style']['typography'] = array();
			}
			$attrs['style']['typography']['fontSize'] = $fs_value;
			$changed = true;
		}
	}

	// 3. Migrate align:center to style.typography.textAlign (WP 7.1 format).
	$valid_text_aligns = array( 'left', 'center', 'right' );
	if ( ! empty( $attrs['align'] ) && in_array( $attrs['align'], $valid_text_aligns, true ) ) {
		if ( empty( $attrs['style']['typography']['textAlign'] ) ) {
			if ( ! isset( $attrs['style'] ) ) {
				$attrs['style'] = array();
			}
			if ( ! isset( $attrs['style']['typography'] ) ) {
				$attrs['style']['typography'] = array();
			}
			$attrs['style']['typography']['textAlign'] = $attrs['align'];
			$changed = true;
		}
		unset( $attrs['align'] );
		$changed = true;
	}

	if ( $changed ) {
		// Rebuild innerHTML to match what WP save() would produce.
		$classes = array();
		if ( ! empty( $attrs['style']['typography']['textAlign'] ) ) {
			$classes[] = 'has-text-align-' . $attrs['style']['typography']['textAlign'];
		}
		$class_str = $classes ? ' class="' . implode( ' ', $classes ) . '"' : '';

		$styles = array();
		if ( ! empty( $attrs['style']['typography']['fontSize'] ) ) {
			$styles[] = 'font-size:' . $attrs['style']['typography']['fontSize'];
		}
		$style_str = $styles ? ' style="' . implode( ';', $styles ) . '"' : '';

		// Extract the text content from the existing HTML.
		$text = preg_replace( '/<p[^>]*>(.*?)<\/p>/s', '$1', $html, 1 );
		if ( '' === $text ) {
			$text = trim( strip_tags( $html ) );
		}
		$block['innerHTML']      = '<p' . $class_str . $style_str . '>' . $text . '</p>';
		$block['innerContent']   = array( $block['innerHTML'] );
	}
}

/**
 * Insert $new into $parent at child index $index, keeping innerContent in sync.
 *
 * WordPress's serialize_blocks() walks a block's innerContent array and emits the
 * k-th innerBlock for the k-th NULL slot. Splicing innerBlocks alone therefore
 * shifts every later child one slot late and silently DROPS the final child, so an
 * insert appears to succeed (the new block's markup is written) while the block
 * count stays the same. We must add the matching NULL slot too.
 *
 * A null $parent->innerContent means the child list is a top-level list (the post
 * root), where there is no wrapper to keep in sync.
 */
function teb_splice_child( &$parent, $index, $new ) {
	array_splice( $parent['innerBlocks'], $index, 0, array( $new ) );

	if ( empty( $parent['innerContent'] ) || ! is_array( $parent['innerContent'] ) ) {
		return;
	}

	// Map the innerBlocks index to an innerContent index. Child N lives in the
	// slot that immediately FOLLOWS the Nth NULL, so the new NULL goes after the
	// $index-th NULL. (Inserting before it would put the child outside the
	// wrapper div, since element 0 is the opening tag.)
	$nulls_seen = 0;
	$slot       = count( $parent['innerContent'] );
	foreach ( $parent['innerContent'] as $ci => $chunk ) {
		if ( null === $chunk ) {
			if ( $nulls_seen === $index ) {
				$slot = $ci + 1;
				break;
			}
			$nulls_seen++;
		}
	}
	array_splice( $parent['innerContent'], $slot, 0, array( null ) );
}

/**
 * Recursively normalize all blocks in an array.
 */
function teb_normalize_blocks( &$blocks ) {
	foreach ( $blocks as &$block ) {
		teb_normalize_block( $block );
	}
	unset( $block );
}

/**
 * Apply a structural change to a post's content, return new serialized content.
 */
function teb_apply_change( $post_id, $action, $uuid, $type, $payload, $position ) {
	$raw_injected = false;
	$post    = get_post( $post_id );
	$blocks  = parse_blocks( $post->post_content );
	// Raw post content string, used by the "inside" column injection path. Kept in
	// a local variable (not $post->post_content) so it is safely reachable from the
	// nested closure below without reference pitfalls.
	$content = $post->post_content;

	if ( 'insert' === $action ) {
		$new = teb_build_block( $post_id, $type, $payload );
		if ( ! $new ) {
			return new WP_Error( 'bad_type', 'Unknown block type', array( 'status' => 400 ) );
		}
		if ( $uuid ) {
			// core/column blocks have no FrontEdit uuid (FrontEdit treats the whole
			// columns block as one unit), so the client addresses a column by its
			// stable ordinal index as "col:N". Resolve that to the Nth <!-- wp:column
			// --> opener in the raw content, then inject the new block inside it.
			if ( 'inside' === $position && 0 === strpos( $uuid, 'col:' ) ) {
				$col_index    = (int) substr( $uuid, 4 );
				$serialized   = serialize_blocks( array( $new ) );
				$raw_injected = false;
				$inserted     = false;
				// Match every column opener in document order, then grab the
				// opening <div class="wp-block-column ..."> that belongs to it.
				// The new block must be injected INSIDE that div (not after the
				// <!-- wp:column --> comment) or WordPress renders it as a
				// top-level sibling of the column instead of as its content.
				if ( preg_match_all( '#<!-- wp:column \{[^}]*\} -->\s*(<div\s+class="[^"]*\bwp-block-column\b[^"]*"[^>]*>)#', $content, $openers, PREG_OFFSET_CAPTURE ) ) {
					if ( isset( $openers[1][ $col_index ] ) ) {
						$at = $openers[1][ $col_index ][1] + strlen( $openers[1][ $col_index ][0] );
						$content = substr( $content, 0, $at )
							. "\n" . $serialized . "\n"
							. substr( $content, $at );
						$raw_injected = true;
						$inserted     = true;
					}
				}
				if ( ! $inserted ) {
					return new WP_Error( 'bad_col', 'Column index out of range', array( 'status' => 400 ) );
				}
			} else {
				$inserted     = false;
				$raw_injected = false;
				$walk = function ( &$list, &$parent ) use ( $new, $uuid, $position, &$inserted, &$walk, &$content, &$raw_injected ) {
					foreach ( $list as $i => &$b ) {
						if ( ( $b['attrs']['mwpSfeUuid'] ?? '' ) === $uuid ) {
							if ( 'inside' === $position ) {
								$serialized = serialize_blocks( array( $new ) );
								$pattern = '#(<!-- wp:column \{[^}]*\bmwpSfeUuid":"' . preg_quote( $uuid, '#' ) . '"[^}]*\} -->)#';
								if ( preg_match( $pattern, $content, $mm, PREG_OFFSET_CAPTURE ) ) {
									$at   = $mm[1][1] + strlen( $mm[1][0] );
									$content = substr( $content, 0, $at )
										. "\n" . $serialized . "\n"
										. substr( $content, $at );
									$inserted     = true;
									$raw_injected = true;
									unset( $b );
									return;
								}
								unset( $b );
								return;
							}
							$ins_idx = ( 'after' === $position ) ? $i + 1 : $i;
							// $parent is the block that owns this child list. When it has an
							// innerContent array we must add the matching NULL slot there too,
							// or serialize_blocks() drops the block we just inserted.
							if ( is_array( $parent ) && ! empty( $parent['innerContent'] ) ) {
								teb_splice_child( $parent, $ins_idx, $new );
							} else {
								array_splice( $list, $ins_idx, 0, array( $new ) );
							}
							$inserted = true;
							unset( $b );
							return;
						}
						if ( ! empty( $b['innerBlocks'] ) ) {
							$walk( $b['innerBlocks'], $b );
							if ( $inserted ) {
								unset( $b );
								return;
							}
						}
					}
					unset( $b );
				};
				// Top-level list: there is no parent block owning an innerContent array.
				$root = null;
				$walk( $blocks, $root );
			}
			if ( ! $inserted ) {
				$blocks[] = $new;
			}
		} else {
			$blocks[] = $new;
		}
	} elseif ( 'duplicate' === $action ) {
		// Find the target block by UUID and clone it. We operate on raw content
		// strings (not the parsed block tree) so that nested blocks inside
		// columns are handled correctly — the parsed tree has an innerContent/
		// innerBlocks mismatch that serialize_blocks can't reconcile.
		$target_serialized = teb_extract_serialized_block( $content, $uuid );
		if ( '' === $target_serialized ) {
			return new WP_Error( 'not_found', 'Block not found', array( 'status' => 404 ) );
		}
		// Parse the target block to get its structure, clone it with a new UUID.
		$blocks_tmp = parse_blocks( $target_serialized );
		if ( empty( $blocks_tmp ) ) {
			return new WP_Error( 'bad_data', 'Could not parse block', array( 'status' => 400 ) );
		}
		$clone             = $blocks_tmp[0];
		$clone['attrs']    = $clone['attrs'] ?? array();
		$clone['attrs']['mwpSfeUuid']        = teb_new_uuid( $post_id, $clone['blockName'] );
		$clone['attrs']['mwpSfeUuidShadow']  = $clone['attrs']['mwpSfeUuid'];
		$clone_serialized  = serialize_blocks( array( $clone ) );
		// Inject the clone right after the target block in the raw content.
		$content = str_replace(
			$target_serialized,
			$target_serialized . "\n" . $clone_serialized,
			$content
		);
		$raw_injected = true;
	} elseif ( 'delete' === $action ) {
		// Use raw content removal so nested blocks inside columns are handled
		// correctly (parsed-tree splice has innerContent/innerBlocks mismatch).
		$content    = teb_remove_serialized_block( $content, $uuid );
		$raw_injected = true;
	} elseif ( 'reorder' === $action ) {
		// Move $uuid to sit immediately before/after the target block's UUID.
		// Both blocks must live within the same parent list (a block cannot be
		// dragged into a different nesting level).
		$target = isset( $payload['target'] ) ? sanitize_text_field( (string) $payload['target'] ) : '';
		$pos    = isset( $payload['position'] ) ? sanitize_key( (string) $payload['position'] ) : 'after';
		if ( ! $target || $target === $uuid ) {
			return new WP_Error( 'bad_target', 'Invalid reorder target', array( 'status' => 400 ) );
		}

		// Walk the tree once, recording the index path (from root) to each
		// block. We mutate via the path afterwards so we never depend on PHP's
		// fragile by-reference handling of array elements.
		$paths = array( 'src' => null, 'dst' => null );
		$walk  = function ( $list, $trail ) use ( $uuid, $target, &$walk, &$paths ) {
			foreach ( $list as $i => $b ) {
				$here = array_merge( $trail, array( $i ) );
				if ( ( $b['attrs']['mwpSfeUuid'] ?? '' ) === $uuid ) {
					$paths['src'] = $here;
				} elseif ( ( $b['attrs']['mwpSfeUuid'] ?? '' ) === $target ) {
					$paths['dst'] = $here;
				}
				if ( ! empty( $b['innerBlocks'] ) ) {
					$walk( $b['innerBlocks'], $here );
				}
				if ( $paths['src'] && $paths['dst'] ) {
					return;
				}
			}
		};
		$walk( $blocks, array() );

		if ( ! $paths['src'] || ! $paths['dst'] ) {
			return new WP_Error( 'not_found', 'Block not found', array( 'status' => 404 ) );
		}

		$src_parent = array_slice( $paths['src'], 0, -1 );
		$dst_parent = array_slice( $paths['dst'], 0, -1 );
		$from       = end( $paths['src'] );
		$to         = end( $paths['dst'] );

		if ( $src_parent === $dst_parent ) {
			// Same parent: simple splice (original path).
			$list = &$blocks;
			foreach ( $src_parent as $step ) {
				$list = &$list[ $step ]['innerBlocks'];
			}
			$moved = $list[ $from ];
			array_splice( $list, $from, 1 );
			$target_index = ( $to > $from ) ? $to - 1 : $to;
			$offset       = ( 'after' === $pos ) ? 1 : 0;
			array_splice( $list, $target_index + $offset, 0, array( $moved ) );
		} else {
			// Cross-container move (e.g. from one column to another).
			// Resolve the source list and remove the block.
			$src_list = &$blocks;
			foreach ( $src_parent as $step ) {
				$src_list = &$src_list[ $step ]['innerBlocks'];
			}
			$moved = $src_list[ $from ];
			array_splice( $src_list, $from, 1 );
			// Resolve the destination list and insert the block.
			$dst_list = &$blocks;
			foreach ( $dst_parent as $step ) {
				$dst_list = &$dst_list[ $step ]['innerBlocks'];
			}
			// Recalculate destination index after source removal if needed.
			$dst_parent_is_src = ( $dst_parent === $src_parent );
			// Both lists are different, so the target index is unaffected by removal.
			$offset = ( 'after' === $pos ) ? 1 : 0;
			array_splice( $dst_list, $to + $offset, 0, array( $moved ) );
		}
	} else {
		return new WP_Error( 'bad_action', 'Unknown action', array( 'status' => 400 ) );
	}

	if ( $raw_injected ) {
		// Raw content was mutated directly (duplicate/delete). Re-parse, normalize,
		// and re-serialize to ensure the output is valid.
		$norm_blocks = parse_blocks( $content );
		teb_normalize_blocks( $norm_blocks );
		return serialize_blocks( $norm_blocks );
	}
	teb_normalize_blocks( $blocks );
	return serialize_blocks( $blocks );
}

function teb_register_routes() {
	register_rest_route(
		'teb/v1',
		'/block-action',
		array(
			'methods'             => 'POST',
			'permission_callback' => function ( $request ) {
				$post_id = (int) $request->get_param( 'post_id' );
				return $post_id && current_user_can( 'edit_post', $post_id );
			},
			'callback'            => function ( $request ) {
			$post_id = (int) $request->get_param( 'post_id' );
			$action  = sanitize_key( $request->get_param( 'action' ) );
			$uuid    = sanitize_text_field( (string) $request->get_param( 'uuid' ) );
			$type    = sanitize_key( (string) $request->get_param( 'type' ) );
			$raw     = $request->get_param( 'payload' );
			if ( is_string( $raw ) && '' !== $raw ) {
				$decoded = json_decode( $raw, true );
				$payload = is_array( $decoded ) ? $decoded : array();
			} else {
				$payload = is_array( $raw ) ? $raw : array();
			}
			$position = sanitize_key( (string) $request->get_param( 'position' ) );

				if ( ! $post_id || ! in_array( $action, array( 'insert', 'duplicate', 'delete', 'reorder' ), true ) ) {
					return new WP_Error( 'bad_request', 'Invalid request', array( 'status' => 400 ) );
				}

			// UUID-targeted actions (duplicate/delete/reorder, and "inside" inserts that
			// target an existing block by uuid) look the block up by its mwpSfeUuid inside
			// post_content. A post that has never been saved through FrontEdit's UUID-baking
			// path has no uuids baked into its content yet, so those actions would fail with
			// "Block not found". Bake uuids into the post first (idempotent) so the target
			// block is always resolvable. For 'insert' we only bake when a target uuid is
			// supplied (an "inside" insert); top-level inserts need no existing uuid.
			if ( class_exists( 'MWPSFE_UUID_Manager' )
				&& ( 'insert' !== $action || '' !== $uuid )
			) {
					$uuid_manager = MWPSFE_UUID_Manager::instance();
					if ( method_exists( $uuid_manager, 'ensure_uuids_for_post' ) ) {
						$post = get_post( $post_id );
						if ( $post ) {
							try {
								$uuid_manager->ensure_uuids_for_post( $post );
							} catch ( \Throwable $e ) {
								// Baking is best-effort; structural edits still work
								// against FrontEdit's runtime uuids regardless.
							}
						}
					}
				}

			$content = teb_apply_change( $post_id, $action, $uuid, $type, $payload, $position );
			if ( is_wp_error( $content ) ) {
				return $content;
			}

				wp_update_post( array( 'ID' => $post_id, 'post_content' => $content ) );

			// Keep FrontEdit's UUID bookkeeping consistent for THIS post only.
			// (Avoid the manager's invalidate_all_post_caches(), which flushes
			// every cache site-wide and makes saves hang on large installs.)
			if ( class_exists( 'MWPSFE_UUID_Manager' ) ) {
				$uuid_manager = MWPSFE_UUID_Manager::instance();
				if ( method_exists( $uuid_manager, 'invalidate_post_uuid_cache' ) ) {
					$uuid_manager->invalidate_post_uuid_cache( $post_id );
				}
			}

			// Return the post's current revision token so the frontend can re-sync
			// FrontEdit's optimistic-concurrency token. Our own save bumps the
			// token, and without this sync the NEXT FrontEdit inline save sees a
			// stale token and falsely reports "updated by another user".
			$token = 0;
			if ( class_exists( 'MWPSFE_Manager' ) ) {
				$manager = MWPSFE_Manager::instance();
				if ( method_exists( $manager, 'get_post_revision_token' ) ) {
					$token = (int) $manager->get_post_revision_token( $post_id );
				}
			}

				return rest_ensure_response(
					array(
						'success'              => true,
						'page_revision_token' => $token,
					)
				);
			},
		)
	);

	// ---- Revisions: get / set post content for undo/redo ----
	register_rest_route(
		'teb/v1',
		'/get-content',
		array(
			'methods'             => 'POST',
			'permission_callback' => function ( $request ) {
				$post_id = (int) $request->get_param( 'post_id' );
				return $post_id && current_user_can( 'edit_post', $post_id );
			},
			'callback'            => function ( $request ) {
				$post_id = (int) $request->get_param( 'post_id' );
				$post    = get_post( $post_id );
				if ( ! $post ) {
					return new WP_Error( 'not_found', 'Post not found', array( 'status' => 404 ) );
				}
				return rest_ensure_response( array(
					'success' => true,
					'content' => $post->post_content,
				) );
			},
		)
	);

	register_rest_route(
		'teb/v1',
		'/restore-content',
		array(
			'methods'             => 'POST',
			'permission_callback' => function ( $request ) {
				$post_id = (int) $request->get_param( 'post_id' );
				return $post_id && current_user_can( 'edit_post', $post_id );
			},
			'callback'            => function ( $request ) {
				$post_id = (int) $request->get_param( 'post_id' );
				$content = $request->get_param( 'content' );
				if ( ! is_string( $content ) ) {
					return new WP_Error( 'bad_content', 'Invalid content', array( 'status' => 400 ) );
				}
				$post = get_post( $post_id );
				if ( ! $post ) {
					return new WP_Error( 'not_found', 'Post not found', array( 'status' => 404 ) );
				}
				wp_update_post( array(
					'ID'           => $post_id,
					'post_content' => $content,
				) );
				if ( class_exists( 'MWPSFE_UUID_Manager' ) ) {
					$uuid_manager = MWPSFE_UUID_Manager::instance();
					if ( method_exists( $uuid_manager, 'invalidate_post_uuid_cache' ) ) {
						$uuid_manager->invalidate_post_uuid_cache( $post_id );
					}
				}
				return rest_ensure_response( array( 'success' => true ) );
			},
		)
	);
}
