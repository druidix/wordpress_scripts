<?php
/**
 * Plugin Name: Contest Gallery → ifn_subs_2026 media folder
 * Description: Files every Contest Gallery frontend upload into the Responsive
 *              Lightbox & Gallery "Media Folder" named ifn_subs_2026, so a
 *              folder-sourced gallery picks the uploads up automatically.
 * Version:     0.1
 * Author:      you
 *
 * INSTALL
 *   Drop this file in wp-content/mu-plugins/ (create that folder if it doesn't
 *   exist). mu-plugins autoload — no activation step. (Or install as a normal
 *   plugin.)
 *
 * WHY THIS EXISTS
 *   Contest Gallery has no setting to assign uploads to a media folder, and
 *   dFactory's "Media Folders" are just a taxonomy on attachments. So we hook
 *   the moment WordPress creates the attachment and add the folder term.
 *
 * TWO THINGS TO CONFIRM ON YOUR INSTALL (both handled defensively below):
 *   1. The exact request that Contest Gallery uploads use — see DEBUG below.
 *   2. The taxonomy dFactory registered for folders — auto-resolved, no slug
 *      hardcoded.
 */

if (!defined('ABSPATH')) exit;

const CG2FOLDER_NAME  = 'ifn_subs_2026'; // the Media Folder name to file into
const CG2FOLDER_DEBUG = true;           // true → log decisions to the PHP error log

/**
 * Which admin-ajax action(s) count as a Contest Gallery frontend upload.
 * Confirm the real value on your site: set CG2FOLDER_DEBUG = true, do ONE test
 * upload through the contest form, then read wp-content/debug.log (needs
 * WP_DEBUG + WP_DEBUG_LOG) for the "[cg2folder] add_attachment ... action=..."
 * line. Put that string here and set DEBUG back to false.
 *
 * Leave empty to fall back to the heuristic in cg2folder_looks_like_contest_gallery().
 */
function cg2folder_cg_actions() {
    return array(
        'post_cg_gallery_form_upload',   // confirmed via debug log on this install
    );
}

add_action('add_attachment', 'cg2folder_on_add_attachment', 20);
function cg2folder_on_add_attachment($attachment_id) {

    $action = isset($_REQUEST['action']) ? sanitize_key(wp_unslash($_REQUEST['action'])) : '';

    if (CG2FOLDER_DEBUG) {
        error_log(sprintf(
            '[cg2folder] add_attachment #%d action=%s ajax=%s admin=%s referer=%s',
            $attachment_id, $action, wp_doing_ajax() ? 'y' : 'n',
            is_admin() ? 'y' : 'n', wp_get_referer()
        ));
    }

    $cg_actions = cg2folder_cg_actions();
    $is_cg = $cg_actions
        ? in_array($action, $cg_actions, true)
        : cg2folder_looks_like_contest_gallery();
    if (!$is_cg) return;

    $folder = cg2folder_resolve_folder(CG2FOLDER_NAME);
    if (!$folder) {
        if (CG2FOLDER_DEBUG) error_log('[cg2folder] folder term not found: ' . CG2FOLDER_NAME);
        return;
    }

    // append = true, so we never clobber an existing folder assignment.
    $res = wp_set_object_terms($attachment_id, (int) $folder['term_id'], $folder['taxonomy'], true);

    if (CG2FOLDER_DEBUG) {
        error_log('[cg2folder] filed #' . $attachment_id . ' into '
            . $folder['taxonomy'] . ':' . $folder['term_id'] . ' => ' . wp_json_encode($res));
    }
}

/**
 * Heuristic used ONLY when cg2folder_cg_actions() is empty. Treats a front-end
 * (non-wp-admin) upload that carries Contest Gallery-ish fields as a contest
 * upload. Tighten this once you know the real action (above).
 */
function cg2folder_looks_like_contest_gallery() {
    if (is_admin() && !wp_doing_ajax()) return false; // skip normal wp-admin media uploads
    foreach (array_keys($_REQUEST) as $k) {
        $k = strtolower($k);
        if (strpos($k, 'contest') !== false || strpos($k, 'cg_') === 0 || strpos($k, 'cgallery') !== false) {
            return true;
        }
    }
    return false;
}

/**
 * Resolve a Media Folder term by name or slug across whatever taxonomy dFactory
 * registered, preferring the taxonomy that applies to attachments.
 * Returns ['term_id'=>int,'taxonomy'=>string] or null. No slug hardcoded, so it
 * keeps working if the plugin changes its taxonomy name.
 */
function cg2folder_resolve_folder($name) {
    global $wpdb;
    $rows = $wpdb->get_results($wpdb->prepare(
        "SELECT t.term_id, tt.taxonomy
           FROM {$wpdb->terms} t
           JOIN {$wpdb->term_taxonomy} tt ON tt.term_id = t.term_id
          WHERE t.name = %s OR t.slug = %s",
        $name, sanitize_title($name)
    ));
    if (!$rows) return null;

    foreach ($rows as $r) {
        $tax = get_taxonomy($r->taxonomy);
        if ($tax && in_array('attachment', (array) $tax->object_type, true)) {
            return array('term_id' => (int) $r->term_id, 'taxonomy' => $r->taxonomy);
        }
    }
    return array('term_id' => (int) $rows[0]->term_id, 'taxonomy' => $rows[0]->taxonomy);
}
