(function () {
	'use strict';

	var TEB = window.TEB || {};
	var BUSY = false;

	// Localized UI string (TEB.l10n, populated server-side via
	// wp_localize_script). Falls back to the built-in French default.
	function L(key, fallback) {
		return (TEB.l10n && TEB.l10n[key]) || fallback;
	}

	// Structural changes rewrite the post content. Once the save succeeds we
	// re-render the affected blocks IN PLACE (soft refresh) using FrontEdit's own
	// server-rendered HTML — no full page reload. This keeps the editor mounted,
	// preserves scroll position, and is near-instant compared to a reload.
	//
	// A full reload is kept only as a last-resort fallback if the soft refresh
	// cannot obtain authoritative block HTML.
	function apiCore(action, uuid, type, payload, position, label) {
		if (BUSY) { return; }
		BUSY = true;
		showLoader(label || L('saving', 'Enregistrement…'));

		var body = new URLSearchParams();
		body.set('post_id', TEB.postId);
		body.set('action', action);
		if (uuid) body.set('uuid', uuid);
		if (type) body.set('type', type);
		if (position) body.set('position', position);
		if (payload) body.set('payload', JSON.stringify(payload));

		// Remember the reference block so we can re-attach the chip to a sensible
		// block after the soft refresh (the DOM nodes get replaced).
		var refUuid = (action === 'insert' || action === 'duplicate') ? uuid : null;

		function doFetch(attempt) {
			var ctrl = new AbortController();
			var timer = setTimeout(function () { ctrl.abort(); }, 45000);
			fetch(TEB.restUrl, {
				method: 'POST',
				headers: {
					'X-WP-Nonce': TEB.nonce,
					'Content-Type': 'application/x-www-form-urlencoded'
				},
				body: body.toString(),
				signal: ctrl.signal
			})
				.then(function (r) {
					return r.json();
				})
				.then(function (res) {
					clearTimeout(timer);
					if (res && res.success) {
						// Re-sync FrontEdit's optimistic-concurrency token. Our own
						// save bumps the post revision token; leaving FrontEdit's stale
						// copy would make the NEXT inline save trip the bogus
						// "updated by another user since you started editing" dialog.
						if (res.page_revision_token) {
							var tok = parseInt(res.page_revision_token, 10);
							window.__tebPageRevisionToken = tok;
							if (window.MWP && window.MWP.SFE && window.MWP.SFE.Context) {
								window.MWP.SFE.Context.pageRevisionToken = tok;
							}
							if (window.MWP && window.MWP.SFE && window.MWP.SFE.ManagerData) {
								window.MWP.SFE.ManagerData.pageRevisionToken = tok;
							}
						}
						// The save has succeeded on the server. Hide the loading overlay
						// immediately so it can never get "stuck" waiting on the in-place
						// re-render below (which depends on a flaky ddev fetch). The user
						// always gets their UI back; correctness of the DOM is guaranteed
						// by the soft-refresh-or-reload safety net.
						hideLoader();
						BUSY = false;
						// For DELETE: immediately remove the block from the DOM. The
						// soft refresh only reconciles top-level blocks (a nested block
						// inside a column is skipped by isTopLevelBlock), so without
						// this the deleted block would persist in the DOM until the
						// next full reload.
						// For DELETE: immediately remove the block from the DOM and
						// skip the soft refresh. The soft refresh reconciles blocks
						// by UUID and only processes top-level nodes — a nested block
						// inside a column is invisible to it, so the re-render would
						// restore the deleted block from the (stale) doc fetch. Just
						// remove the node and reset FrontEdit state so the user can
						// continue editing without a full page reload.
						if (action === 'delete' && uuid) {
							var delEl = document.querySelector('[data-mwp-sfe-uuid="' + uuid + '"]');
							if (delEl && delEl.parentNode) {
								delEl.parentNode.removeChild(delEl);
							}
							resetFrontEditState();
							return;
						}
						// Best-effort in-place re-render. If it completes we avoid a flash;
						// if the authoritative HTML can't be fetched in time we fall back
						// to a full reload so the page is never left stale. Once the DOM is
						// refreshed we must also reset FrontEdit's editor bookkeeping so it
						// doesn't believe the page now has unsaved changes (the native
						// "changes you made may not be saved" beforeunload prompt) or a
						// stale revision token (the "updated by another user" conflict
						// dialog on the next inline save).
						var done = false;
						var safety = setTimeout(function () {
							if (!done) { done = true; location.reload(); }
						}, 6000);
						softRefreshContent(action, refUuid, type)
							.then(function (ok) {
								if (done) return;        // safety already reloaded
								done = true;
								clearTimeout(safety);
								if (!ok) { location.reload(); return; }
								resetFrontEditState();
							})
							.catch(function () {
								if (done) return;
								done = true;
								clearTimeout(safety);
								location.reload();
							});
					} else if (attempt < 2) {
						doFetch(attempt + 1);
					} else {
						hideLoader();
						BUSY = false;
						var errMsg = (res && (res.message || res.error)) || L('errorAction', 'Action échouée.');
						tebAlert(L('errorTitle', 'Erreur'), errMsg, 'error');
					}
				})
				.catch(function () {
					clearTimeout(timer);
					if (attempt < 2) {
						doFetch(attempt + 1);
					} else {
						hideLoader();
						BUSY = false;
						tebAlert(L('errorNetworkTitle', 'Erreur réseau'), L('errorNetwork', 'Impossible de contacter le serveur. Vérifiez votre connexion et réessayez.'), 'error');
					}
				});
		}
		doFetch(1);
	}

	// ---- Loading overlay (spinner + status text) ----
	var loader = null;
	function showLoader(text) {
		if (!loader) {
			loader = document.createElement('div');
			loader.className = 'teb-loader';
			loader.innerHTML =
				'<div class="teb-loader-box">' +
				'<div class="teb-spinner"></div>' +
				'<div class="teb-loader-text"></div>' +
				'</div>';
			document.body.appendChild(loader);
		}
		loader.querySelector('.teb-loader-text').textContent = text || L('saving', 'Enregistrement…');
		loader.style.display = 'flex';
	}
	function hideLoader() {
		if (loader) loader.style.display = 'none';
	}

	// ---- Single floating chip that follows the active block ----
	// Active block is tracked by its UUID string (data-mwp-sfe-uuid) rather than
	// by a live element reference, so it survives the in-place swaps that the
	// soft refresh performs after every structural change.
	var chip = null;
	var handle = null;              // left gutter drag handle for the active block
	var activeUuid = null;          // UUID of the block the chip is attached to
	var selectedColumn = null;      // ordinal index of a selected core/column among
	                                // .wp-block-column elements (survives FrontEdit's
	                                // re-render, which detaches the column element).
	var deselected = false;         // true after an intentional outside-click; keeps
	                                // the chip hidden until a block is (re)selected,
	                                // even though FrontEdit still stamps .mwp-sfe-element-active
	var hoveredEl = null;           // deprecated: kept only to seed activeUuid
	var uiLocked = false;           // true while inserter/media-picker is open:
	                                // freeze the active block so FrontEdit's hover
	                                // (which re-stamps .mwp-sfe-element-active) can't
	                                // reselect a different block under the cursor.
	var dragUuid = null;            // uuid of the block being dragged (reorder)
	var dragSourceEl = null;

	function buildChip() {
		chip = document.createElement('div');
		chip.className = 'teb-chip';
		chip.style.display = 'none';
		chip.innerHTML =
			'<button type="button" class="teb-btn teb-add" title="' + L('addBlock', 'Ajouter un bloc') + '">+</button>' +
			'<button type="button" class="teb-btn teb-dup" title="' + L('duplicate', 'Dupliquer') + '">⧉</button>' +
			'<button type="button" class="teb-btn teb-del" title="' + L('delete', 'Supprimer') + '">🗑</button>';

		chip.querySelector('.teb-add').addEventListener('click', function (e) {
			e.stopPropagation(); e.preventDefault();
			var el = resolveActive();
			// If a column is selected (selectedColumn is set) OR the active block
			// lives inside a column, insert into the column via col:N path. The
			// col:N path injects at the END of the column's raw HTML, which is the
			// only reliable way to add blocks inside a column (the "after" path
			// uses innerBlocks which loses UUIDs during serialization).
			if (selectedColumn !== null) {
				var colEl = resolveSelectedColumn();
				if (colEl) {
					activeUuid = null;
					showInserter(colEl, 'col:' + selectedColumn, 'inside');
					return;
				}
			}
			if (el) {
				var inCol = el.closest && el.closest('.wp-block-column');
				if (inCol) {
					// Block is inside a column — find the column index and use col:N.
					var colWrapper = inCol.closest('.wp-block-columns');
					if (colWrapper) {
						var colIdx = Array.prototype.indexOf.call(
							colWrapper.querySelectorAll('.wp-block-column'), inCol
						);
						if (colIdx >= 0) {
							selectedColumn = colIdx;
							activeUuid = null;
							showInserter(inCol, 'col:' + colIdx, 'inside');
							return;
						}
					}
				}
				var pos = el.classList.contains('wp-block-column') ? 'inside' : 'after';
				showInserter(el, activeUuid, pos);
			}
		});
		chip.querySelector('.teb-dup').addEventListener('click', function (e) {
			e.stopPropagation(); e.preventDefault();
			if (activeUuid) apiCore('duplicate', activeUuid, null, {}, null, L('dupProgress', 'Duplication du bloc…'));
		});
		chip.querySelector('.teb-del').addEventListener('click', function (e) {
			e.stopPropagation(); e.preventDefault();
			if (!activeUuid) return;
			tebConfirm(L('delConfirmTitle', 'Supprimer le bloc'), L('delConfirmBody', 'Voulez-vous vraiment supprimer ce bloc ? Cette action est irréversible.')).then(function (ok) {
				if (ok) apiCore('delete', activeUuid, null, {}, null, L('delProgress', 'Suppression du bloc\u2026'));
			});
		});

		document.body.appendChild(chip);
	}

	// ---- Custom modal dialogs (replace raw alert/confirm) ----
	function tebModal(opts) {
		return new Promise(function (resolve) {
			var overlay = document.createElement('div');
			overlay.className = 'teb-modal-overlay';
			var bodyCls = opts.type === 'error' ? ' teb-modal-error' : '';
			overlay.innerHTML =
				'<div class="teb-modal">' +
				(opts.title ? '<div class="teb-modal-title">' + opts.title + '</div>' : '') +
				'<div class="teb-modal-body' + bodyCls + '">' + opts.message + '</div>' +
				'<div class="teb-modal-actions">' +
				(opts.cancelText ? '<button class="teb-modal-btn teb-modal-btn-cancel" data-action="cancel">' + opts.cancelText + '</button>' : '') +
				'<button class="teb-modal-btn ' + (opts.danger ? 'teb-modal-btn-danger' : 'teb-modal-btn-ok') + '" data-action="ok">' + opts.okText + '</button>' +
				'</div></div>';
			function close(result) {
				overlay.remove();
				resolve(result);
			}
			overlay.addEventListener('click', function (e) {
				if (e.target === overlay) close(opts.cancelValue !== undefined ? opts.cancelValue : false);
			});
			overlay.querySelectorAll('.teb-modal-btn').forEach(function (btn) {
				btn.addEventListener('click', function () {
					var action = btn.getAttribute('data-action');
					close(action === 'ok');
				});
			});
			document.body.appendChild(overlay);
			// Focus the confirm/danger button for keyboard accessibility.
			var primary = overlay.querySelector('.teb-modal-btn-danger, .teb-modal-btn-ok');
			if (primary) primary.focus();
			// Allow Enter/Escape to confirm/cancel.
			overlay.tabIndex = -1;
			overlay.addEventListener('keydown', function (e) {
				if (e.key === 'Enter') close(true);
				else if (e.key === 'Escape') close(opts.cancelValue !== undefined ? opts.cancelValue : false);
			});
		});
	}

	function tebConfirm(title, message) {
		return tebModal({
			title: title,
			message: message,
			okText: L('confirm', 'Confirmer'),
			cancelText: L('cancel', 'Annuler'),
			danger: true,
		});
	}

	function tebAlert(title, message, type) {
		return tebModal({
			title: title,
			message: message,
			okText: 'OK',
			type: type || 'info',
		});
	}

	// A patterned vertical gutter pinned to the LEFT of the active block; it is the
	// drag handle for reordering (a strip reads better than a tiny grip glyph).
	// We use POINTER-EVENT dragging (not native HTML5 DnD) because native DnD is
	// unreliable here: the page is in FrontEdit edit mode (body pointer-events:none)
	// and the handle is position:fixed, both of which break the browser's drag pipe.
	function buildHandle() {
		handle = document.createElement('div');
		handle.className = 'teb-handle';
		handle.style.display = 'none';
		handle.title = L('moveHandle', 'Déplacer (glisser) — le réordonnancement à l\'intérieur d\'une colonne n\'est pas encore supporté');

		handle.addEventListener('pointerdown', function (e) {
			e.preventDefault();
			var el = resolveActive();
			if (!el) return;
			dragUuid = el.getAttribute('data-mwp-sfe-uuid');
			dragSourceEl = el;
			el.classList.add('teb-dragging');
			handle.classList.add('teb-handle-active');

			// Manual viewport hit-test: pick the sibling block nearest the cursor,
			// by shortest distance from the cursor to the block's rect. More
			// forgiving than strict containment (gaps, short blocks, scroll shifts).
			function blockFromClient(x, y) {
				// Search all blocks in the page (not just siblings) so dragging
				// between columns works. The nearest valid target is chosen.
				var sibs = Array.prototype.slice.call(
					document.querySelectorAll('[data-mwp-sfe-uuid]')
				);
				var best = null, bestDist = Infinity;
				for (var i = 0; i < sibs.length; i++) {
					if (sibs[i] === dragSourceEl) continue;
					var r = sibs[i].getBoundingClientRect();
					if (r.width === 0 && r.height === 0) continue;
					var cx = Math.max(r.left, Math.min(x, r.right));
					var cy = Math.max(r.top, Math.min(y, r.bottom));
					var d = Math.hypot(x - cx, y - cy);
					if (d < bestDist) { bestDist = d; best = sibs[i]; }
				}
				return best;
			}

			function onMove(ev) {
				var over = blockFromClient(ev.clientX, ev.clientY);
				clearDropTargets();
				if (!over || !siblingOf(dragSourceEl, over) || over === dragSourceEl) return;
				var rect = over.getBoundingClientRect();
				var before = (ev.clientY - rect.top) < rect.height / 2;
				over.classList.add(before ? 'teb-drop-before' : 'teb-drop-after');
			}
			function onUp(ev) {
				document.removeEventListener('pointermove', onMove);
				document.removeEventListener('pointerup', onUp);
				handle.classList.remove('teb-handle-active');
				if (dragSourceEl) dragSourceEl.classList.remove('teb-dragging');
				var over = blockFromClient(ev.clientX, ev.clientY);
				clearDropTargets();
				if (over && siblingOf(dragSourceEl, over) && over !== dragSourceEl) {
					var rect = over.getBoundingClientRect();
					var before = (ev.clientY - rect.top) < rect.height / 2;
					apiCore('reorder', dragUuid, null,
						{ target: over.getAttribute('data-mwp-sfe-uuid'), position: before ? 'before' : 'after' },
						null, L('reorderProgress', 'Réorganisation du bloc…'));
				}
				dragUuid = null; dragSourceEl = null;
			}
			// Listen on document so the drag continues even when the cursor leaves
			// the handle, and the release is always caught.
			document.addEventListener('pointermove', onMove);
			document.addEventListener('pointerup', onUp);
		});
		document.body.appendChild(handle);
	}

	function blockFromPoint(target) {
		return target && target.closest ? target.closest('[data-mwp-sfe-uuid]') : null;
	}

	// The set of .wp-block-column elements that really belong to a core/columns
	// block. FrontEdit's re-renders and soft refreshes can leave stray/duplicate
	// .wp-block-column siblings directly under .entry-content; those are NOT
	// serialized on the server (the server counts <!-- wp:column --> openers), so
	// they must not shift the ordinal index. Keep global document order so the
	// index matches the server's global column-opener count across multiple blocks.
	function liveColumns() {
		return Array.prototype.filter.call(
			document.querySelectorAll('.wp-block-column'),
			function (c) { return c.closest('.wp-block-columns') !== null; }
		);
	}

	// Re-resolve the column selected by index (selectedColumn) against the LIVE DOM.
	// core/column blocks have no FrontEdit uuid (FrontEdit renders the whole
	// core/columns block as one unit), so we address them purely by their stable
	// ordinal index among liveColumns(). FrontEdit may re-render the columns block
	// and detach the element, but the index stays valid as long as the column count
	// is unchanged.
	function resolveSelectedColumn() {
		if (null === selectedColumn) return null;
		var el = liveColumns()[selectedColumn];
		return el ? el : null;
	}

	function clearColumnSelection() {
		if (selectedColumn !== null) {
			var cols = document.querySelectorAll('.wp-block-column.teb-col-selected');
			for (var i = 0; i < cols.length; i++) {
				cols[i].classList.remove('teb-col-selected');
			}
			selectedColumn = null;
		}
	}

	function resolveActive() {
		if (activeUuid) {
			var el = document.querySelector('[data-mwp-sfe-uuid="' + activeUuid + '"]');
			if (el) return el;
			activeUuid = null; // block no longer in DOM
		}
		// Fall back to FrontEdit's currently active block.
		var active = document.querySelector('.mwp-sfe-element-active[data-mwp-sfe-uuid]');
		if (active) {
			activeUuid = active.getAttribute('data-mwp-sfe-uuid');
			return active;
		}
		return null;
	}

	function isOwnUI(target) {
		return target && target.closest &&
			target.closest('.teb-chip, .teb-handle, .teb-inserter, .teb-media-modal, .teb-global-btn, .teb-loader, .teb-modal-overlay');
	}

	function onDocClick(e) {
		if (isOwnUI(e.target)) return;
		// Modal overlay is "own UI" — its click events should not deselect blocks.
		if (e.target.closest && e.target.closest('.teb-modal-overlay')) return;
		// Any click outside our own UI dismisses an open inserter / media picker,
		// then (re)selects the block under the cursor (or deselects if outside).
		// We deliberately do NOT early-return while uiLocked: with the inserter
		// open the user must be able to click another block to switch to it (and
		// close the inserter), otherwise the chip + inserter would stay stuck.
		closeInserter();
		closeMediaPicker();
		var el = blockFromPoint(e.target);
		// When clicking inside a .wp-block-column, blockFromPoint() may return the
		// column wrapper instead of the inner block (FrontEdit re-renders the whole
		// columns block on column click, which can detach inner elements). Walk up
		// from the actual click target to find the innermost [data-mwp-sfe-uuid]
		// element that sits inside a .wp-block-column — that is the block the user
		// intended to select.
		if (el && el.classList && el.classList.contains('wp-block-columns')) {
			var inner = e.target.closest('.wp-block-column [data-mwp-sfe-uuid]');
			if (inner) el = inner;
		}
		// core/column blocks have no FrontEdit uuid (FrontEdit treats the whole
		// columns block as one unit), so select them by stable ordinal index.
		var isCol = el && el.classList && el.classList.contains('wp-block-column');
		if (el && (el.getAttribute('data-mwp-sfe-uuid') || isCol)) {
			// Selecting a (different) block closes any open inserter and re-anchors
			// the chip + handle onto the newly selected block.
			if (handle) handle.style.display = 'none';
			deselected = false;
			activeUuid = el.getAttribute('data-mwp-sfe-uuid');
			window.__tebActive = activeUuid;
			hoveredEl = el;
			// A core/column only becomes selectable through our own handling:
			// FrontEdit treats the whole core/columns block as one unit and, on a
			// column click, re-renders the columns block (detaching the column
			// element and baking a fresh uuid). That detaches our selection before
			// the user can press "+", so we can't rely on the column's uuid/element
			// surviving. Instead track the column by its STABLE ordinal index among
			// all .wp-block-column elements and re-derive the live uuid at insert
			// time. We also mark it selected ourselves (custom class) for the green
			// "selected" outline + drop shadow, without touching FrontEdit's own
			// selection state (which would trigger its re-render).
			clearColumnSelection();
			if (el.classList.contains('wp-block-column')) {
				// Scope the ordinal to columns that really belong to a core/columns
				// block, in global document order (see liveColumns()).
				selectedColumn = liveColumns().indexOf(el);
				el.classList.add('teb-col-selected');
			}
			positionChip();
		} else {
			// Clicked outside any block: hide chip + handle, close inserter, and
			// clear the active selection so no panels or borders linger. Mark the
			// selection as deliberately deselected so positionChip() stays hidden
			// even though FrontEdit keeps stamping .mwp-sfe-element-active on the
			// previously-selected block (its MutationObserver would otherwise
			// re-show the chip via resolveActive()'s fallback).
			deselected = true;
			activeUuid = null;
			clearColumnSelection();
			// Remove FrontEdit's own active-block marker so its selection-tracking
			// MutationObserver has nothing to re-show. (FrontEdit re-stamps it on the
			// next real hover/click, so this only affects the deliberate deselect.)
			var feActive = document.querySelectorAll('.mwp-sfe-element-active');
			for (var fi = 0; fi < feActive.length; fi++) {
				feActive[fi].classList.remove('mwp-sfe-element-active');
			}
			if (chip) chip.style.display = 'none';
			if (handle) handle.style.display = 'none';
		}
	}

	// Track FrontEdit's active block via class mutation (survives DOM swaps).
	function observeActiveBlock() {
		var observer = new MutationObserver(function () {
			// Don't let FrontEdit's hover-driven selection steal the active block
			// while the user is choosing a block type / image in our UI.
			if (uiLocked) return;
			var el = document.querySelector('.mwp-sfe-element-active[data-mwp-sfe-uuid]');
			if ( ! el ) return;
			var feUuid = el.getAttribute('data-mwp-sfe-uuid');
			// FrontEdit only treats the whole core/columns block as selectable, so a
			// click on an individual column lands .mwp-sfe-element-active on the
			// columns WRAPPER. We track column-level selection ourselves (a column is
			// a [data-mwp-sfe-uuid] element too). If our current selection is a
			// column that lives inside this wrapper, keep it — don't let the wrapper
			// steal it (that would break "insert inside this column").
			if ( el.classList.contains('wp-block-columns') ) {
				var cur = activeUuid ? document.querySelector('[data-mwp-sfe-uuid="' + activeUuid + '"]') : null;
				if ( cur && cur.closest('.wp-block-columns') === el ) {
					// Current selection lives inside this columns block (either a
					// column wrapper or a block inside a column). Keep it.
					return;
				}
			}
			deselected = false;
			activeUuid = feUuid;
			positionChip();
		});
		observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
	}

	function positionChip() {
		// An intentional outside-click set deselected=true; keep the chip/handle
		// hidden regardless of FrontEdit's lingering .mwp-sfe-element-active.
		if (deselected) { if (chip) chip.style.display = 'none'; if (handle) handle.style.display = 'none'; return; }
		var el = resolveActive();
		if (!el || !chip) { if (chip) chip.style.display = 'none'; if (handle) handle.style.display = 'none'; return; }
		if (!isEditing()) { chip.style.display = 'none'; if (handle) handle.style.display = 'none'; return; }
		var uuid = el.getAttribute('data-mwp-sfe-uuid');
		if (!uuid) { chip.style.display = 'none'; if (handle) handle.style.display = 'none'; return; }
		activeUuid = uuid;
		var rect = el.getBoundingClientRect();
		if (!rect.width && !rect.height) { chip.style.display = 'none'; if (handle) handle.style.display = 'none'; return; }

		// --- Chip: top-right of the block, but clamp inside the viewport so it
		// never hides behind the browser chrome or drifts off-screen on scroll. ---
		chip.style.display = 'flex';
		var cw = chip.offsetWidth || 90;
		var ch = chip.offsetHeight || 32;
		var top = rect.top - ch - 8;
		if (top < 4) top = Math.max(4, rect.top + 4);
		var left = rect.right - cw - 6;
		if (left < 4) left = 4;
		chip.style.top = top + 'px';
		chip.style.left = left + 'px';

		// --- Handle: patterned gutter pinned to the LEFT edge of the block,
		// vertically centred, and clamped to the viewport. ---
		if (handle) {
			handle.style.display = 'block';
			var hh = handle.offsetHeight || 40;
			var hTop = rect.top + (rect.height - hh) / 2;
			if (hTop < 4) hTop = 4;
			if (hTop + hh > window.innerHeight - 4) hTop = window.innerHeight - hh - 4;
			handle.style.top = hTop + 'px';
			handle.style.left = Math.max(0, rect.left - handle.offsetWidth - 6) + 'px';
		}
	}

	function closeInserter() {
		var p = document.querySelector('.teb-inserter');
		if (p) p.remove();
		document.body.classList.remove('teb-inserter-open');
		// Only release the lock if no media picker is keeping the UI open.
		if (!document.querySelector('.teb-media-modal')) uiLocked = false;
	}

	// After our own structural save + in-place soft refresh, FrontEdit still holds
	// the pre-save editor state: a "dirty" block set (which triggers the native
	// "changes you made may not be saved" beforeunload prompt) and a stale revision
	// token (which triggers the "updated by another user" conflict dialog on the
	// next inline save). Our save has already persisted everything, so clear that
	// stale bookkeeping to match reality.
	function resetFrontEditState() {
		var SFE = window.MWP && window.MWP.SFE;
		if (!SFE) return;
		// Clear the dirty-block tracking so no unsaved-changes prompt appears.
		if (SFE.BatchEditManager && SFE.BatchEditManager.dirtyBlocks &&
			typeof SFE.BatchEditManager.dirtyBlocks.clear === 'function') {
			SFE.BatchEditManager.dirtyBlocks.clear();
		}
		// Resync the optimistic-concurrency token from the server response.
		if (window.__tebPageRevisionToken) {
			var tok = parseInt(window.__tebPageRevisionToken, 10);
			if (SFE.Context) SFE.Context.pageRevisionToken = tok;
			if (SFE.ManagerData) SFE.ManagerData.pageRevisionToken = tok;
		}
		// Belt-and-braces: suppress the next native beforeunload prompt once.
		if (SFE.UnsavedChanges && typeof SFE.UnsavedChanges.suppressNextBeforeUnload === 'function') {
			SFE.UnsavedChanges.suppressNextBeforeUnload();
		}
	}

	// ---- Media picker (library + upload) for the Image block ----
	// Opens a modal so the user can pick a photo from the WP media library or
	// upload a new file. On confirm we insert a core/image block that already
	// carries the chosen photo via our own save path (no FrontEdit inline
	// media-save, which is broken on this site).
	function closeMediaPicker() {
		var m = document.querySelector('.teb-media-modal');
		if (m) m.remove();
		// Only release the lock if no inserter is keeping the UI open.
		if (!document.querySelector('.teb-inserter')) uiLocked = false;
	}

	function openMediaPicker(refUuid, position) {
		closeMediaPicker();
		uiLocked = true; // keep the active block frozen while picking an image
		var modal = document.createElement('div');
		modal.className = 'teb-media-modal';
		modal.innerHTML =
			'<div class="teb-media-box">' +
			'<div class="teb-media-head">' + L('chooseImage', 'Choisir une image') +
			'<button type="button" class="teb-media-close" title="' + L('close', 'Fermer') + '">×</button></div>' +
			'<div class="teb-media-tabs">' +
			'<button type="button" class="teb-media-tab teb-tab-active" data-tab="library">' + L('library', 'Bibliothèque') + '</button>' +
			'<button type="button" class="teb-media-tab" data-tab="upload">' + L('upload', 'Téléverser') + '</button>' +
			'</div>' +
			'<div class="teb-media-body">' +
			'<div class="teb-media-pane" data-pane="library">' +
			'<div class="teb-media-search"><input type="search" placeholder="' + L('search', 'Rechercher…') + '" class="teb-media-search-input"></div>' +
			'<div class="teb-media-grid"><div class="teb-media-loading">' + L('loading', 'Chargement…') + '</div></div>' +
			'</div>' +
			'<div class="teb-media-pane" data-pane="upload" style="display:none">' +
			'<input type="file" accept="image/*" class="teb-media-file">' +
			'<div class="teb-media-upload-status"></div>' +
			'</div>' +
			'</div>' +
			'<div class="teb-media-foot">' +
			'<button type="button" class="teb-media-cancel">' + L('cancel', 'Annuler') + '</button>' +
			'<button type="button" class="teb-media-insert" disabled>' + L('insertImage', 'Insérer l\'image') + '</button>' +
			'</div>' +
			'</div>';
		document.body.appendChild(modal);

		var selected = null; // { url, id, alt }
		var grid = modal.querySelector('.teb-media-grid');
		var insertBtn = modal.querySelector('.teb-media-insert');
		var searchInput = modal.querySelector('.teb-media-search-input');
		var uploadStatus = modal.querySelector('.teb-media-upload-status');

		function setSelected(meta) {
			selected = meta;
			insertBtn.disabled = !selected;
			grid.querySelectorAll('.teb-media-item').forEach(function (it) {
				it.classList.toggle('teb-media-selected', it.getAttribute('data-id') === String(meta.id));
			});
		}

		function loadLibrary(search) {
			grid.innerHTML = '<div class="teb-media-loading">' + L('loading', 'Chargement…') + '</div>';
			var url = TEB.restBase + 'wp/v2/media?media_type=image&per_page=30&status=inherit';
			if (search) url += '&search=' + encodeURIComponent(search);
			fetch(url, { headers: { 'X-WP-Nonce': TEB.nonce } })
				.then(function (r) { return r.json(); })
				.then(function (items) {
					if (!Array.isArray(items) || !items.length) {
						grid.innerHTML = '<div class="teb-media-empty">' + L('noMedia', 'Aucun média trouvé.') + '</div>';
						return;
					}
					grid.innerHTML = '';
					items.forEach(function (it) {
						var src = (it.media_details && it.media_details.sizes &&
							it.media_details.sizes.medium && it.media_details.sizes.medium.source_url) ||
							it.source_url || '';
						if (!src) return;
						var item = document.createElement('button');
						item.type = 'button';
						item.className = 'teb-media-item';
						item.setAttribute('data-id', String(it.id));
						item.innerHTML = '<img src="' + src + '" alt=""><span class="teb-media-name">' +
							(String(it.alt_text || it.title && it.title.rendered || it.id)) + '</span>';
						item.addEventListener('click', function () {
							setSelected({ url: it.source_url, id: it.id, alt: it.alt_text || '' });
						});
						grid.appendChild(item);
					});
				})
				.catch(function () {
					grid.innerHTML = '<div class="teb-media-empty">' + L('libraryLoadFail', 'Échec du chargement de la bibliothèque.') + '</div>';
				});
		}

		function uploadFile(file) {
			uploadStatus.textContent = L('uploading', 'Téléversement…');
			uploadStatus.className = 'teb-media-upload-status';
			var fd = new FormData();
			fd.append('file', file);
			fetch(TEB.restBase + 'wp/v2/media', {
				method: 'POST',
				headers: { 'X-WP-Nonce': TEB.nonce },
				body: fd
			})
				.then(function (r) {
					if (!r.ok) throw new Error('upload failed: ' + r.status);
					return r.json();
				})
				.then(function (res) {
					uploadStatus.textContent = L('uploaded', 'Image téléversée.');
					setSelected({ url: res.source_url, id: res.id, alt: res.alt_text || '' });
				})
				.catch(function (err) {
					uploadStatus.textContent = L('uploadFail', 'Échec du téléversement: ') + err.message;
					uploadStatus.className = 'teb-media-upload-status teb-media-error';
				});
		}

		// Tabs
		modal.querySelectorAll('.teb-media-tab').forEach(function (tab) {
			tab.addEventListener('click', function () {
				var name = tab.getAttribute('data-tab');
				modal.querySelectorAll('.teb-media-tab').forEach(function (t) {
					t.classList.toggle('teb-tab-active', t === tab);
				});
				modal.querySelectorAll('.teb-media-pane').forEach(function (p) {
					p.style.display = (p.getAttribute('data-pane') === name) ? '' : 'none';
				});
			});
		});

		modal.querySelector('.teb-media-close').addEventListener('click', closeMediaPicker);
		modal.querySelector('.teb-media-cancel').addEventListener('click', closeMediaPicker);
		modal.addEventListener('click', function (e) { if (e.target === modal) closeMediaPicker(); });
		searchInput.addEventListener('input', function () {
			clearTimeout(searchInput._t);
			searchInput._t = setTimeout(function () { loadLibrary(searchInput.value.trim()); }, 350);
		});
		modal.querySelector('.teb-media-file').addEventListener('change', function (e) {
			if (e.target.files && e.target.files[0]) uploadFile(e.target.files[0]);
		});
		insertBtn.addEventListener('click', function () {
			if (!selected) return;
			closeMediaPicker();
			apiCore('insert', refUuid, 'image',
				{ url: selected.url, id: selected.id, alt: selected.alt }, position, L('addImageProgress', 'Ajout d\'une image…'));
		});

		loadLibrary('');
	}

	function showInserter(anchorEl, refUuid, position) {
		closeInserter();
		document.body.classList.add('teb-inserter-open');
		uiLocked = true; // freeze the active block so hover can't reselect another
		var picker = document.createElement('div');
		picker.className = 'teb-inserter';
		var types = [
			{ t: 'paragraph', l: L('typeParagraph', 'Paragraphe') },
			{ t: 'heading', l: L('typeHeading', 'Titre') },
			{ t: 'list', l: L('typeList', 'Liste') },
			{ t: 'button', l: L('typeButton', 'Bouton') },
			{ t: 'image', l: L('typeImage', 'Image') },
			{ t: 'video', l: L('typeVideo', 'Vidéo') },
			{ t: 'columns', l: L('typeColumns', 'Colonnes') },
			{ t: 'spacer', l: L('typeSpacer', 'Espace') },
			{ t: 'html', l: L('typeHtml', 'HTML') }
		];
		var html = '<div class="teb-inserter-head">' + L('addBlock', 'Ajouter un bloc') + '</div><div class="teb-inserter-grid">';
		types.forEach(function (o) {
			html += '<button type="button" class="teb-type" data-type="' + o.t + '">' + o.l + '</button>';
		});
		// Columns sub-choice: quick count buttons (backward-compatible with tests)
		// plus unified layout presets that pair a column count with widths. The
		// old separate count + width buttons made no interactive sense because a
		// "50/50" preset is meaningless after choosing 3 columns.
		html += '<div class="teb-cols-choice" style="display:none">' +
			'<span class="teb-cols-label">' + L('colCountLabel', 'Nombre de colonnes :') + '</span>' +
			'<div class="teb-cols-counts">' +
			'<button type="button" class="teb-cols-opt" data-count="2" title="' + L('colEq2', '2 colonnes égales') + '">2</button>' +
			'<button type="button" class="teb-cols-opt" data-count="3" title="' + L('colEq3', '3 colonnes égales') + '">3</button>' +
			'<button type="button" class="teb-cols-opt" data-count="4" title="' + L('colEq4', '4 colonnes égales') + '">4</button>' +
			'</div>' +
			'<span class="teb-cols-label" style="margin-top:8px">' + L('layoutsLabel', 'Layouts :') + '</span>' +
			'<div class="teb-cols-layouts">' +
			'<button type="button" class="teb-cols-layout" data-count="2" data-widths="50%,50%" title="' + L('colEq2', '2 colonnes égales') + '"><span class="teb-layout-bars"><span style="flex:1"></span><span style="flex:1"></span></span><span class="teb-layout-label">2 égales</span></button>' +
			'<button type="button" class="teb-cols-layout" data-count="2" data-widths="33.33%,66.67%" title="' + L('layout2_13_23', '2 colonnes 1/3 - 2/3') + '"><span class="teb-layout-bars"><span style="flex:1"></span><span style="flex:2"></span></span><span class="teb-layout-label">1/3 - 2/3</span></button>' +
			'<button type="button" class="teb-cols-layout" data-count="2" data-widths="66.67%,33.33%" title="' + L('layout2_23_13', '2 colonnes 2/3 - 1/3') + '"><span class="teb-layout-bars"><span style="flex:2"></span><span style="flex:1"></span></span><span class="teb-layout-label">2/3 - 1/3</span></button>' +
			'<button type="button" class="teb-cols-layout" data-count="2" data-widths="25%,75%" title="' + L('layout2_14_34', '2 colonnes 1/4 - 3/4') + '"><span class="teb-layout-bars"><span style="flex:1"></span><span style="flex:3"></span></span><span class="teb-layout-label">1/4 - 3/4</span></button>' +
			'<button type="button" class="teb-cols-layout" data-count="2" data-widths="75%,25%" title="' + L('layout2_34_14', '2 colonnes 3/4 - 1/4') + '"><span class="teb-layout-bars"><span style="flex:3"></span><span style="flex:1"></span></span><span class="teb-layout-label">3/4 - 1/4</span></button>' +
			'<button type="button" class="teb-cols-layout" data-count="3" data-widths="33.33%,33.33%,33.33%" title="' + L('colEq3', '3 colonnes égales') + '"><span class="teb-layout-bars"><span style="flex:1"></span><span style="flex:1"></span><span style="flex:1"></span></span><span class="teb-layout-label">3 égales</span></button>' +
			'<button type="button" class="teb-cols-layout" data-count="3" data-widths="25%,50%,25%" title="' + L('layout3_121', '3 colonnes 1/4 - 1/2 - 1/4') + '"><span class="teb-layout-bars"><span style="flex:1"></span><span style="flex:2"></span><span style="flex:1"></span></span><span class="teb-layout-label">1/4 - 1/2 - 1/4</span></button>' +
			'<button type="button" class="teb-cols-layout" data-count="4" data-widths="25%,25%,25%,25%" title="' + L('colEq4', '4 colonnes égales') + '"><span class="teb-layout-bars"><span style="flex:1"></span><span style="flex:1"></span><span style="flex:1"></span><span style="flex:1"></span></span><span class="teb-layout-label">4 égales</span></button>' +
			'</div></div>';
		html += '</div><button type="button" class="teb-cancel">' + L('cancel', 'Annuler') + '</button>';
		picker.innerHTML = html;

		picker.querySelectorAll('.teb-type').forEach(function (btn) {
			btn.addEventListener('click', function (e) {
				e.stopPropagation(); e.preventDefault();
				var type = btn.getAttribute('data-type');
				if (type === 'columns') {
					// Toggle the 2/3/4 chooser instead of inserting immediately.
					var choice = picker.querySelector('.teb-cols-choice');
					var showing = choice.style.display !== 'none';
					choice.style.display = showing ? 'none' : '';
					// Panel size changed — re-clamp so the chooser stays on-screen.
					repositionInserter(picker, anchorEl);
					return;
				}
				closeInserter();
				if (type === 'image') {
					// Open our own media picker (library + upload) and insert the
					// chosen photo via the normal save path — FrontEdit's inline
					// image media-save is broken on this site ("no changes to save").
					openMediaPicker(refUuid, position);
					return;
				}
				if (type === 'video') {
					// Prompt for video URL (YouTube, Vimeo, or direct).
					var url = prompt(L('videoPrompt', 'URL de la vidéo (YouTube, Vimeo, ou direct) :'));
					if (url && url.trim()) {
						apiCore('insert', refUuid, 'video', { url: url.trim() }, position, L('addVideoProgress', 'Ajout de vidéo…'));
					}
					return;
				}
				apiCore('insert', refUuid, type, {}, position, L('addBlockProgress', 'Ajout d\'un bloc…'));
			});
		});
		// Quick count buttons: insert equal-width columns immediately (keeps tests
		// and the simple "just give me N columns" path working).
		picker.querySelectorAll('.teb-cols-opt').forEach(function (opt) {
			opt.addEventListener('click', function (e) {
				e.stopPropagation(); e.preventDefault();
				var count = parseInt(opt.getAttribute('data-count'), 10) || 2;
				closeInserter();
				apiCore('insert', refUuid, 'columns', { count: count, widths: [] }, position, L('addColumnProgress', 'Ajout de colonnes…'));
			});
		});
		// Layout presets: each button defines both count and widths, so the choice
		// always makes sense as a single click.
		picker.querySelectorAll('.teb-cols-layout').forEach(function (btn) {
			btn.addEventListener('click', function (e) {
				e.stopPropagation(); e.preventDefault();
				var count = parseInt(btn.getAttribute('data-count'), 10) || 2;
				var widths = btn.getAttribute('data-widths') || '';
				var widthsArr = widths ? widths.split(',') : [];
				closeInserter();
				apiCore('insert', refUuid, 'columns', { count: count, widths: widthsArr }, position, L('addColumnProgress', 'Ajout de colonnes…'));
			});
		});
		picker.querySelector('.teb-cancel').addEventListener('click', function (e) {
			e.stopPropagation(); e.preventDefault();
			closeInserter();
		});

		document.body.appendChild(picker);
		repositionInserter(picker, anchorEl);
	}

	// Clamp the inserter panel fully inside the viewport (the columns sub-choice
	// can grow it, so we re-run this whenever its contents change or on resize).
	function repositionInserter(picker, anchorEl) {
		if (!picker) picker = document.querySelector('.teb-inserter');
		if (!picker) return;
		if (!anchorEl) {
			var act = resolveActive();
			anchorEl = act || picker;
		}
		var rect = anchorEl.getBoundingClientRect();
		// position:fixed -> viewport-relative. Clamp so the panel (including the
		// columns sub-choice) always stays fully on-screen regardless of scroll.
		var pw = picker.offsetWidth || 220;
		var ph = picker.offsetHeight || 260;
		var top = rect.top + rect.height + 8;
		if (top + ph > window.innerHeight - 8) {
			// Not enough room below: prefer above the block; if that also clips,
			// pin to the top of the viewport.
			var above = rect.top - ph - 8;
			top = above > 4 ? above : Math.max(4, window.innerHeight - ph - 8);
		}
		if (top < 4) top = 4;
		var left = rect.left;
		if (left + pw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pw - 8);
		picker.style.top = top + 'px';
		picker.style.left = left + 'px';
	}

	// ---- Soft refresh: re-render blocks in place (no page reload) ----
	// Fetches FrontEdit's server-rendered page (which carries the authoritative
	// mwpSfeUuid attributes), then swaps each live block with its fresh HTML and
	// inserts/removes blocks whose UUID set changed. Returns true on success.
	//
	// @param {string} action   The action that triggered the refresh.
	// @param {string} refUuid  Reference block UUID (insert/duplicate target).
	// @param {string} newType  Block type that was just inserted (for editor kick-off).
	function softRefreshContent(action, refUuid, newType) {
		return new Promise(function (resolve) {
			if (!window.MWP || !window.MWP.SFE || !window.MWP.SFE.SaveHelpers ||
				typeof window.MWP.SFE.SaveHelpers.fetchRenderedPageDocument !== 'function' ||
				!window.MWP.SFE.ElementUpdater ||
				typeof window.MWP.SFE.ElementUpdater.applyNewHTML !== 'function') {
				resolve(false);
				return;
			}
			var SFE = window.MWP.SFE;

			// FrontEdit stamps data-mwp-sfe-uuid on EVERY block, including nested
			// ones (each core/column inside a core/columns wrapper). We must only
			// reconcile TOP-LEVEL blocks: a wrapper's outerHTML already carries its
			// nested blocks, so treating the children as independent nodes re-splices
			// them after the wrapper swap and duplicates them (extra columns + strays).
			function isTopLevelBlock(n) {
				return !n.parentElement || !n.parentElement.hasAttribute('data-mwp-sfe-uuid');
			}

			// Snapshot the live blocks (in DOM order) before we mutate anything.
			var liveNodes = Array.prototype.slice.call(
				document.querySelectorAll('[data-mwp-sfe-uuid]')
			).filter(isTopLevelBlock);
			var liveUuids = liveNodes.map(function (n) {
				return n.getAttribute('data-mwp-sfe-uuid');
			});

			SFE.SaveHelpers.fetchRenderedPageDocument({ force: true })
				.then(function (doc) {
					if (!doc || typeof doc.querySelectorAll !== 'function') {
						resolve(false);
						return;
					}

// Build the authoritative doc map (uuid -> node) in doc order.
				var docNodes = Array.prototype.slice.call(
					doc.querySelectorAll('[data-mwp-sfe-uuid]')
				).filter(isTopLevelBlock);
					var docMap = {};
					var docOrder = [];
					docNodes.forEach(function (n) {
						var u = n.getAttribute('data-mwp-sfe-uuid');
						if (u && !docMap[u]) {
							docMap[u] = n;
							docOrder.push(u);
						}
					});

					var docUuidSet = {};
					docOrder.forEach(function (u) { docUuidSet[u] = true; });

					// 1) Swap / remove existing live blocks.
					// For reorder actions, skip the HTML swap — only positions change,
					// not content. This avoids triggering script re-execution (e.g.
					// Calendly widget re-initialization) in HTML blocks.
					if (action !== 'reorder') {
						liveNodes.forEach(function (node) {
							var u = node.getAttribute('data-mwp-sfe-uuid');
							if (docMap[u]) {
								var html = docMap[u].outerHTML;
								try {
									SFE.ElementUpdater.applyNewHTML(node, u, html);
								} catch (err) { /* keep existing node */ }
							} else {
								// Block no longer exists in the authoritative render.
								if (node.parentNode) node.parentNode.removeChild(node);
							}
						});
					}

					// 2) Insert new blocks (in doc order) that are not yet live.
var liveAfter = Array.prototype.slice.call(
					document.querySelectorAll('[data-mwp-sfe-uuid]')
				).filter(isTopLevelBlock);
					var liveAfterSet = {};
					liveAfter.forEach(function (n) {
						liveAfterSet[n.getAttribute('data-mwp-sfe-uuid')] = true;
					});

					docOrder.forEach(function (u) {
						if (liveAfterSet[u]) return; // already present
						var fresh = docMap[u];
						if (!fresh) return;
						var freshHtml = fresh.outerHTML;

						// Find where to insert: the first live block that follows
						// this uuid in doc order.
						var refLive = null;
						for (var i = docOrder.indexOf(u) + 1; i < docOrder.length; i++) {
							var cand = document.querySelector('[data-mwp-sfe-uuid="' + docOrder[i] + '"]');
							if (cand) { refLive = cand; break; }
						}
						var tmp = document.createElement('div');
						tmp.innerHTML = freshHtml;
						var newNode = tmp.firstElementChild;
						if (!newNode) return;
						newNode.dataset.mwpSfeUuid = u;
						newNode.dataset.mwpSfeBound = '1';
						if (refLive && refLive.parentNode) {
							refLive.parentNode.insertBefore(newNode, refLive);
						} else if (liveAfter.length) {
							liveAfter[liveAfter.length - 1].parentNode.appendChild(newNode);
						} else {
							document.body.appendChild(newNode);
						}
						// Rebind through FrontEdit so the new block is editable.
						if (SFE.rebindChildren && SFE.attachActionBarToElement) {
							try {
								SFE.rebindChildren(newNode);
								SFE.attachActionBarToElement(newNode);
							} catch (e) { /* non-fatal */ }
						}
						// attachActionBarToElement deletes the bound stamp and only
						// re-stamps if the uuid is in FrontEdit's (stale) uuidMap —
						// freshly inserted blocks aren't there yet, leaving them
						// pointer-events:none and unclickable by the chip/handle UI.
						// Force-stamp so block-tools' own onDocClick can reach them.
						if (!newNode.getAttribute('data-mwp-sfe-bound')) {
							newNode.setAttribute('data-mwp-sfe-bound', '1');
						}
					});

					// 2b) Re-order existing live blocks to match the authoritative doc
					// order. Steps 1–2 only swap HTML in place and splice in NEW blocks;
					// a pure reorder (all uuids already present, positions changed) would
					// otherwise leave the DOM order untouched. Only needed for the reorder
					// action; insert/duplicate/delete already mutate the DOM correctly via
					// steps 1-2, so we skip this pass for them to avoid disturbing the
					// working insert path. NOTE: must NOT `return` here for non-reorder
					// actions — resolve(true) below is what completes the soft-refresh
					// promise (an early return left it pending forever and the 6s safety
					// reload always fired instead of the in-place swap).
					if (action === 'reorder') {
					(function reorderLive() {
						try {
							// For each parent group, re-append its live child blocks in the
							// authoritative doc order. We only touch a parent once and never
							// move nodes across parents, so nesting is preserved and a pure
							// reorder (all uuids present) still takes effect.
							var doneParents = [];
							docOrder.forEach(function (u) {
								var node = document.querySelector('[data-mwp-sfe-uuid="' + u + '"]');
								if (!node || !node.parentNode || doneParents.indexOf(node.parentNode) !== -1) return;
								var parent = node.parentNode;
								doneParents.push(parent);
								var ordered = [];
								docOrder.forEach(function (v) {
									var n = document.querySelector('[data-mwp-sfe-uuid="' + v + '"]');
									if (n && n.parentNode === parent) ordered.push(n);
								});
								ordered.forEach(function (n) { parent.appendChild(n); });
							});
						} catch (e) { /* non-fatal */ }
					})();
					}

					// 3) Re-attach the chip. For an image insert, anchor the chip on
					//    the newly added image block so the user can click it and
					//    open FrontEdit's media picker (which is how image blocks are
					//    edited normally). A programmatic auto-open fights FrontEdit's
					//    editor-open guards, so we surface the block instead.
					if (action === 'insert' && newType === 'image') {
						var newImageUuid = findInsertedUuid(refUuid, docOrder);
						if (newImageUuid) {
							activeUuid = newImageUuid;
							positionChip();
						}
				} else {
					reanchorChipAfterRefresh(action, refUuid);
				}

				// Re-bind FrontEdit affordances (hover border + inline editor) for
				// every block after the in-place swap, so they don't disappear after
				// an insert/duplicate/delete/reorder. Runs async (fires a REST call).
				// Must never block resolve() — a throw here would leave the 6s safety
				// reload to fire.
				try { resyncFrontEditBindings(); } catch (e) { console.error('teb resync failed', e); }

				resolve(true);
				})
				.catch(function (e) {
					resolve(false);
				});
		});
	}

	// After a structural change the reference block is still the right anchor:
	// for insert/duplicate the new block sits right after it (and for duplicate
	// the duplicate is the new one). Re-select it so the chip reappears — but do
	// NOT force FrontEdit's `mwp-sfe-element-active` class (a synthetic click
	// would), which fights FrontEdit's own hover/selection border and makes the
	// block outlines look sporadic. We only track the UUID for our own chip.
	function resyncFrontEditBindings() {
		// `SFE` is module-scoped to the soft-refresh function; at this IIFE level
		// reference the global directly.
		var SFE = window.MWP && window.MWP.SFE;
		try {
			// FrontEdit's soft-refresh (ElementUpdater.applyNewHTML, used in step 1)
			// replaces each existing block's outerHTML but does NOT re-attach FrontEdit's
			// hover outline / inline editor; and its initializer skips any block already
			// carrying the `data-mwp-sfe-bound` stamp. After a structural change every
			// block is left bound=1 yet unbound-to-FrontEdit — no blue border, no edit
			// toolbar. So: register handler lists for any freshly inserted block into
			// FrontEdit's uuidMap, strip the stale bound stamp from every block, then
			// dispatch `teb-soft-refresh` so FrontEdit re-runs its OWN initializer
			// (initializeAllElements) — the exact same path that binds blocks on first
			// page load, which is what actually wires up the hover overlay + inline
			// editor. Done purely client-side: the server-side uuid map is cached for an
			// hour and is stale right after our save, so a REST lookup would miss new blocks.
			if (!SFE || !SFE.ManagerData || !SFE.ManagerData.uuidMap || !SFE.ManagerData.handlers) {
				return;
			}
			var allHandlers = SFE.ManagerData.handlers;
			function blockNameOf(node) {
				var m = (node.className || '').match(/wp-block-([a-z0-9-]+)/);
				return m ? ('core/' + m[1].replace(/^core-/, '')) : null;
			}
			// FrontEdit's handler registry keys handlers by `elementType` (e.g.
			// "Heading", "Paragraph") — the block name without the `core/` prefix and
			// capitalized — which is NOT the same string as the DOM `core/heading`.
			// Match case-insensitively after stripping non-letters so `core/heading`
			// finds `Heading`, `core/media-text` finds `MediaText`, etc.
			function handlersForBlock(bn) {
				if (!bn) return [];
				var suffix = bn.split('/')[1].toLowerCase().replace(/[^a-z]/g, '');
				return allHandlers
					.filter(function (h) { return (h.elementType || '').toLowerCase().replace(/[^a-z]/g, '') === suffix; })
					.map(function (h) { return h.id; });
			}
			var nodes = document.querySelectorAll('[data-mwp-sfe-uuid]');
			for (var i = 0; i < nodes.length; i++) {
				var node = nodes[i];
				var uuid = node.getAttribute('data-mwp-sfe-uuid');
				if (!uuid) continue;
				var entry = SFE.ManagerData.uuidMap[uuid];
				if (!entry || !entry.handlers || !entry.handlers.length) {
					var bn = blockNameOf(node);
					var ids = handlersForBlock(bn);
					if (!ids.length) {
						// Fallback: copy handlers from a same-class live sibling already
						// in the map (handles blocks whose elementType is registered
						// differently from the DOM class).
						for (var j = 0; j < nodes.length; j++) {
							if (nodes[j] !== node && nodes[j].className === node.className) {
								var se = SFE.ManagerData.uuidMap[nodes[j].getAttribute('data-mwp-sfe-uuid')];
								if (se && se.handlers && se.handlers.length) { ids = se.handlers.slice(); break; }
							}
						}
					}
					SFE.ManagerData.uuidMap[uuid] = { handlers: ids, blockName: bn };
					if (SFE.Context && SFE.Context.uuidMap) SFE.Context.uuidMap[uuid] = SFE.ManagerData.uuidMap[uuid];
				}
				// Clear the stale bound stamp so initializeAllElements re-attaches
				// FrontEdit's hover overlay + inline editor on this block.
				node.removeAttribute('data-mwp-sfe-bound');
			}
			// Re-bind every stripped node directly through FrontEdit's PUBLIC API
			// (exposed at SFE.attachActionBarToElement) — the exact per-node call
			// FrontEdit's own initializeAllElements() makes. This replaces the old
			// approach of patching FrontEdit's file to listen for our event, so a
			// stock, unmodified FrontEdit install works.
			if (typeof SFE.attachActionBarToElement === 'function') {
				for (var k = 0; k < nodes.length; k++) {
					SFE.attachActionBarToElement(nodes[k]);
				}
			}
			// Also notify via the custom event: harmless on stock FrontEdit (no
			// listener); patched copies re-run their initializer, which skips
			// already-bound nodes, so it stays idempotent.
			document.dispatchEvent(new Event('teb-soft-refresh'));
		} catch (e) { /* never break the soft refresh */ }
	}

	function reanchorChipAfterRefresh(action, refUuid) {
		var anchor = (refUuid && document.querySelector('[data-mwp-sfe-uuid="' + refUuid + '"]')) ||
			document.querySelector('[data-mwp-sfe-uuid]');
		if (!anchor) {
			if (chip) chip.style.display = 'none';
			return;
		}
		activeUuid = anchor.getAttribute('data-mwp-sfe-uuid');
		positionChip();
	}

	// Determine which uuid was newly inserted relative to refUuid: the block
	// immediately after refUuid in the authoritative doc order with a fresh uuid.
	function findInsertedUuid(refUuid, docOrder) {
		if (!refUuid) {
			// Inserted at end (global add): last doc uuid.
			return docOrder.length ? docOrder[docOrder.length - 1] : null;
		}
		var idx = docOrder.indexOf(refUuid);
		if (idx === -1) return docOrder.length ? docOrder[docOrder.length - 1] : null;
		// For insert 'after', the new block is idx+1; for duplicate it is also
		// the block immediately following the source.
		return docOrder[idx + 1] || null;
	}

	// ---- Drag-to-reorder ----
	// Blocks become drop targets while a drag is in progress. We only allow
	// re-ordering within the same parent list, so the drop target must be a
	// sibling of the dragged block (same parent element). The half of the
	// target nearest the cursor decides insert-before vs insert-after.
	function clearDropTargets() {
		document.querySelectorAll('.teb-drop-before, .teb-drop-after').forEach(function (n) {
			n.classList.remove('teb-drop-before', 'teb-drop-after');
		});
	}

	function siblingOf(dragged, candidate) {
		if (!dragged || !candidate || dragged === candidate) return false;
		// Allow reordering within the same parent, OR dragging between blocks
		// that both live inside the same core/columns wrapper (cross-column move).
		if (dragged.parentElement === candidate.parentElement) return true;
		var colsA = dragged.closest('.wp-block-columns');
		var colsB = candidate.closest('.wp-block-columns');
		return colsA && colsB && colsA === colsB;
	}

	// ---- Inserter type list (with columns sub-choice) ----



	// ---- Bind via event delegation; show only while editing ----
	function isEditing() {
		// The chip/inserter only make sense while FrontEdit is in edit mode.
		if (document.body.classList.contains('mwp-sfe-active-preview')) return false;
		return !!(window.MWP && window.MWP.SFE);
	}

	function hideUI() {
		if (chip) chip.style.display = 'none';
	}

	function showUI() {
		positionChip();
	}

	if (!chip) buildChip();
	if (!handle) buildHandle();

	// Click-to-activate UX (matches FrontEdit): show chip on the clicked block.
	document.addEventListener('click', onDocClick, true);
	observeActiveBlock();

	// FrontEdit re-binds after a soft content refresh; re-resolve the active
	// block and re-show the chip so editing survives insert/duplicate/delete.
	document.addEventListener('teb-soft-refresh', function () {
		activeUuid = null;
		hoveredEl = null;
		if (chip) chip.style.display = 'none';
		var active = document.querySelector('.mwp-sfe-element-active[data-mwp-sfe-uuid]');
		if (active) {
			activeUuid = active.getAttribute('data-mwp-sfe-uuid');
		}
		positionChip();
	});

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', function () {
			positionChip();
		});
	} else {
		positionChip();
	}

	// Keep the chip glued to the active block on scroll/resize, and re-clamp the
	// inserter panel (if open) so it never falls off-screen during layout shifts.
	window.addEventListener('scroll', positionChip, { passive: true });
	window.addEventListener('resize', function () {
		positionChip();
		repositionInserter(null, null);
	});

	// Reset hover state when FrontEdit toggles mode or after load.
	document.addEventListener('mwp-sfe-mode-change', function () {
		activeUuid = null;
		hoveredEl = null;
		if (chip) chip.style.display = 'none';
	});
	window.addEventListener('load', function () { hoveredEl = null; });

	// ---- Revisions: undo / redo via admin bar arrows ----
	(function initRevisions() {
		// Persist revision history in localStorage so it survives page reloads.
		var STORAGE_KEY = 'teb_revisions_' + (typeof TEB !== 'undefined' ? TEB.postId : '');
		var history = [];       // array of { content: string }
		var cursor = -1;        // current position in history
		var prevBtn = null;
		var nextBtn = null;
		var isRestoring = false; // guard against recursive saves during restore

		// Load history from localStorage on init.
		function loadHistory() {
			try {
				var stored = localStorage.getItem(STORAGE_KEY);
				if (stored) {
					var parsed = JSON.parse(stored);
					if (Array.isArray(parsed.history)) {
						history = parsed.history;
						cursor = parsed.cursor || 0;
					}
				}
			} catch (e) { /* ignore */ }
		}

		// Save history to localStorage.
		function saveHistory() {
			try {
				// Limit history to last 20 snapshots to avoid localStorage bloat.
				if (history.length > 20) {
					history = history.slice(history.length - 20);
					cursor = Math.min(cursor, history.length - 1);
				}
				localStorage.setItem(STORAGE_KEY, JSON.stringify({
					history: history,
					cursor: cursor,
				}));
			} catch (e) { /* ignore */ }
		}

		function updateButtons() {
			if (!prevBtn || !nextBtn) return;
			// Show arrows whenever FrontEdit is active on the page (SFE.Context
			// exists and the frontend editor is loaded). The mwp-sfe-is-editing
			// class only appears while the inline editor is open, which is too
			// restrictive — the user wants arrows visible in edit mode (i.e.
			// whenever they're on the frontend editor page).
			var editing = !!(window.MWP && window.MWP.SFE && window.MWP.SFE.Context);
			prevBtn.style.display = editing ? '' : 'none';
			nextBtn.style.display = editing ? '' : 'none';
			// Disable arrows when at the boundary of history.
			if (prevBtn) prevBtn.style.opacity = cursor > 0 ? '1' : '0.35';
			if (nextBtn) nextBtn.style.opacity = cursor < history.length - 1 ? '1' : '0.35';
		}

		function apiPost(endpoint, data) {
			var base = (TEB.restBase || '').replace(/\/+$/, '');
			return fetch(base + endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': TEB.nonce,
				},
				body: JSON.stringify(data),
			}).then(function (r) { return r.json(); });
		}

		// Save a snapshot of the current post_content to the history stack.
		function captureSnapshot() {
			if (isRestoring) return;
			if (!TEB || !TEB.postId) return;
			apiPost('/teb/v1/get-content', { post_id: TEB.postId })
				.then(function (res) {
					if (!res || !res.success || !res.content) return;
					// Trim any forward history when a new action happens.
					history = history.slice(0, cursor + 1);
					history.push({ content: res.content });
					cursor = history.length - 1;
					saveHistory();
					updateButtons();
				})
				.catch(function () { /* non-fatal */ });
		}

		function restoreSnapshot(targetCursor) {
			if (targetCursor < 0 || targetCursor >= history.length) return;
			cursor = targetCursor;
			isRestoring = true;
			apiPost('/teb/v1/restore-content', {
				post_id: TEB.postId,
				content: history[cursor].content,
			}).then(function () {
				isRestoring = false;
				updateButtons();
				// Reload the page so the editor reflects the restored content.
				location.reload();
			}).catch(function () {
				isRestoring = false;
			});
		}

		// Hook into every successful structural save to capture a snapshot.
		var origApiCore = apiCore;
		if (typeof origApiCore === 'function') {
			apiCore = function (action, uuid, type, payload, position, label) {
				origApiCore(action, uuid, type, payload, position, label);
				if (action === 'insert' || action === 'delete' || action === 'duplicate' || action === 'reorder') {
					setTimeout(captureSnapshot, 3000);
				}
			};
		}

		// Build admin bar buttons once the bar exists.
		function buildBarButtons(bar) {
			if (!bar || document.getElementById('teb-rev-prev')) return;
			prevBtn = document.createElement('li');
			prevBtn.id = 'teb-rev-prev';
			prevBtn.innerHTML = '<a href="#" title="' + L('undoTitle', 'Annuler (version précédente)') + '">&#x21BA;</a>';
			prevBtn.querySelector('a').addEventListener('click', function (e) {
				e.preventDefault();
				if (cursor > 0) restoreSnapshot(cursor - 1);
			});
			var label = document.createElement('li');
			label.id = 'teb-rev-label';
			label.textContent = L('versions', 'Versions');
			nextBtn = document.createElement('li');
			nextBtn.id = 'teb-rev-next';
			nextBtn.innerHTML = '<a href="#" title="' + L('redoTitle', 'Rétablir (version suivante)') + '">&#x21BB;</a>';
			nextBtn.querySelector('a').addEventListener('click', function (e) {
				e.preventDefault();
				if (cursor < history.length - 1) restoreSnapshot(cursor + 1);
			});
			// Insert into the admin bar's <ul> after the frontedit toggle.
			var toggle = bar.querySelector('#wp-admin-bar-frontedit-toggle');
			var target = toggle ? toggle.parentNode : bar.querySelector('ul');
			if (target) {
				if (toggle) {
					target.insertBefore(prevBtn, toggle.nextSibling);
					target.insertBefore(label, prevBtn.nextSibling);
					target.insertBefore(nextBtn, label.nextSibling);
				} else {
					target.appendChild(prevBtn);
					target.appendChild(label);
					target.appendChild(nextBtn);
				}
			} else {
				bar.appendChild(prevBtn);
				bar.appendChild(label);
				bar.appendChild(nextBtn);
			}
			updateButtons();
		}

		// Wait for admin bar + FrontEdit to be ready.
		function tryInit() {
			var bar = document.getElementById('wpadminbar');
			if (bar) {
				loadHistory();
				buildBarButtons(bar);
				// Capture the initial state when the editor first loads.
				setTimeout(captureSnapshot, 2000);
				// Re-check edit-mode visibility on mode changes.
				document.addEventListener('mwp-sfe-mode-change', updateButtons);
				// Also observe body class changes for edit mode toggle.
				var obs = new MutationObserver(updateButtons);
				obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
				// Poll until SFE.Context is available (FrontEdit may load after
				// the admin bar), then stop.
				var poll = setInterval(function () {
					if (window.MWP && window.MWP.SFE && window.MWP.SFE.Context) {
						updateButtons();
						clearInterval(poll);
					}
				}, 500);
			} else {
				setTimeout(tryInit, 500);
			}
		}
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', tryInit);
		} else {
			tryInit();
		}
	})();
})();
