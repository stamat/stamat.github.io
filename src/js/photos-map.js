// The map view of the photos page. Loaded only by that page, and it does nothing at all until
// the map view is the one being asked for — no tiles are fetched, no renderer is built, while a
// visitor is looking at the grid.
//
// The pins are server-rendered anchors sitting in a hidden container; this moves them into
// OpenLayers overlays rather than drawing markers of its own, so the link, its accessible name
// and its hover label are the same DOM the rest of the page already styles.

import { apply } from 'ol-mapbox-style'
import Attribution from 'ol/control/Attribution.js'
import Overlay from 'ol/Overlay.js'
import { fromLonLat } from 'ol/proj.js'
import { boundingExtent } from 'ol/extent.js'

// OpenFreeMap asks for neither a key nor a referrer, and its `dark` style is the only one of the
// five that does not fight a black page. It runs on donations: if it stops answering, the catch
// below is what the visitor sees.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark'

const MAX_ZOOM = 12
const PADDING = [48, 48, 48, 48]

// The tile data carries Kosovo as its own country: boundary features with an `adm0_l`/`adm0_r`
// of `XKK`, and a country label under an `iso_a2` of `XK`. This draws the line between it and
// Serbia dashed rather than solid, and drops the separate country label. Kosovo's borders with
// Montenegro, North Macedonia and Albania are untouched — they are the same lines as Serbia's
// with those countries, and stay solid.
//
// The style's own disputed-boundary filter does not reach this. It tests `claimed_by`, and these
// features carry neither that nor `disputed`, so they render as any other national border would.
const KOSOVO = 'XKK'
const SERBIA = 'SRB'
const DASH = [3, 3]

/**
 * One side names `a`, the other names `b` or names nothing. The missing half matters: around the
 * northern tip at lon 20.77–20.83 the same border is carried by two overlapping features, one
 * naming only XKK and one naming only SRB, and a match on both sides at once leaves the second
 * drawing a solid line straight over the dashes of the first.
 *
 * Scanned every tile covering Serbia's borders: that tip is the only place a segment names SRB
 * with no counterpart, so this cannot reach the Hungarian or Romanian border by accident. It is
 * a fact about the data rather than a guarantee — worth re-checking if a planet build ever moves
 * a dash somewhere surprising.
 */
function borderBetween (a, b) {
  return ['any',
    ['all', ['==', ['get', 'adm0_l'], a], ['any', ['==', ['get', 'adm0_r'], b], ['!', ['has', 'adm0_r']]]],
    ['all', ['==', ['get', 'adm0_r'], a], ['any', ['==', ['get', 'adm0_l'], b], ['!', ['has', 'adm0_l']]]]
  ]
}

const KOSOVO_SERBIA_LINE = borderBetween(KOSOVO, SERBIA)

function dashKosovoSerbiaBorder (style) {
  const layers = []

  for (const layer of style.layers) {
    const base = layer.filter

    // Below zoom 5 the tiles carry no country codes at all: every border in the world arrives as
    // one merged, attribute-less line, so no filter can separate this one from the rest and it
    // would draw solid. The layer goes instead — at that scale the map is a continent with four
    // photographs on it, and coastlines carry it. Borders return, dashed one included, at zoom 5.
    if (layer.id === 'boundary_country_z0-4') continue

    if (layer.id.startsWith('boundary_country')) {
      // A copy of the layer drawing only this one border, dashed, immediately above the original
      // drawing everything else. Cloned rather than hand-written so it keeps whatever width,
      // colour and zoom curve the style already uses — one border differs, not two styles.
      const dashed = structuredClone(layer)
      dashed.id = `${layer.id}__kosovo`
      dashed.filter = base ? ['all', base, KOSOVO_SERBIA_LINE] : KOSOVO_SERBIA_LINE
      dashed.paint = { ...dashed.paint, 'line-dasharray': DASH }

      layer.filter = base ? ['all', base, ['!', KOSOVO_SERBIA_LINE]] : ['!', KOSOVO_SERBIA_LINE]
      layers.push(layer, dashed)
      continue
    }

    if (layer.id.startsWith('place_country')) {
      const notKosovo = ['!=', ['get', 'iso_a2'], 'XK']
      layer.filter = base ? ['all', base, notKosovo] : notKosovo
    }

    layers.push(layer)
  }

  style.layers = layers
  return style
}

function readPins (source) {
  return Array.from(source.querySelectorAll('.photo-pin'))
    .map((element) => {
      const lat = Number.parseFloat(element.dataset.lat)
      const lng = Number.parseFloat(element.dataset.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
      return { element, coordinate: fromLonLat([lng, lat]) }
    })
    .filter(Boolean)
}

function init () {
  const container = document.getElementById('map')
  const source = document.querySelector('.photo-pins')
  if (!container || !source) return

  const pins = readPins(source)
  if (!pins.length) return

  let map = null
  let starting = false

  function build () {
    container.textContent = ''
    // Fetched rather than handed to apply() as a URL, because the style is edited on the way in.
    // Same request either way — apply() would have made it itself.
    fetch(STYLE_URL).then((response) => {
      if (!response.ok) throw new Error('style ' + response.status)
      return response.json()
    }).then((style) => apply(container, dashKosovoSerbiaBorder(style), { styleUrl: STYLE_URL })).then((created) => {
      map = created

      for (const pin of pins) {
        // A wrapper, because OpenLayers positions an overlay by writing to the element's own
        // `transform` — put the anchor there directly and it loses the scale it grows by on hover.
        const anchor = document.createElement('div')
        anchor.className = 'photo-pin-anchor'
        anchor.append(pin.element)
        map.addOverlay(new Overlay({
          element: anchor,
          position: pin.coordinate,
          positioning: 'center-center',
          // Left true, a drag begun on a pin never reaches the map and the view sticks.
          stopEvent: false
        }))
      }

      // Attribution is a licence condition, not a nicety, so it does not get to hide behind a
      // button. Replaced rather than told to expand: the control re-derives collapsibility from
      // its layers on every frame, and only honours a value it was constructed with — so
      // setCollapsible() on the default one is undone by the next render.
      for (const control of map.getControls().getArray().slice()) {
        if (control instanceof Attribution) map.removeControl(control)
      }
      map.addControl(new Attribution({ collapsible: false }))

      map.getView().fit(boundingExtent(pins.map((pin) => pin.coordinate)), {
        padding: PADDING,
        maxZoom: MAX_ZOOM
      })
      map.updateSize()
    }).catch(() => {
      container.textContent = ''
      container.append(failureNotice())
    })
  }

  // The container is display:none until its fragment is targeted, and a renderer measures the
  // box it is given — so this waits for the reveal rather than running at load.
  function show () {
    if (window.location.hash !== '#map') return
    if (map) {
      map.updateSize()
      return
    }
    if (starting) return
    starting = true
    build()
  }

  window.addEventListener('hashchange', show)
  show()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
