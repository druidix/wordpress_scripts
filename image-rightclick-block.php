<?php
/**
 * Plugin Name: Image Right-Click Block
 * Description: Blocks the right-click menu on images and lightbox overlays only. Everything else on the site keeps normal right-click behavior.
 * Version: 1.0
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

add_action( 'wp_footer', function () {
    if ( is_admin() ) {
        return;
    }
    // Optional: let logged-in editors right-click normally.
    // if ( current_user_can( 'edit_posts' ) ) { return; }
    ?>
    <style>
        img {
            -webkit-user-drag: none;
            user-drag: none;
            -webkit-touch-callout: none;
            -webkit-user-select: none;
            user-select: none;
        }
        .nivo-lightbox-overlay {
            -webkit-touch-callout: none;
        }
    </style>
    <script>
    (function () {
        // Containers used by common lightboxes / WooCommerce galleries.
        // Add your lightbox's class here if it isn't covered.
        var LIGHTBOX = [
            '.mfp-container',                    // Magnific Popup
            '.pswp',                             // PhotoSwipe (WooCommerce default)
            '.fancybox-container',               // Fancybox
            '.lb-outerContainer',                // Lightbox2
            '.elementor-lightbox',               // Elementor
            '.woocommerce-product-gallery',      // Woo gallery + zoom overlay
            '.wp-lightbox-overlay',               // WordPress core lightbox
            '.nivo-lightbox-overlay',            // Nivo Lightbox (backdrop + image)
        ].join(',');

        window.addEventListener('contextmenu', function (e) {
            var t = e.target;
            if (!t || !t.closest) return;

            var isImage = /^(IMG|PICTURE|CANVAS)$/.test(t.tagName);
            var inLightbox = t.closest(LIGHTBOX) !== null;

            if (isImage || inLightbox) {
                e.preventDefault();
            }
        }, true); // capture phase, so it fires before lightbox handlers
    })();
    </script>
    <?php
}, 99 );
