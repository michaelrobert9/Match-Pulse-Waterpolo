// A reference image for a support article. Renders the real screenshot when a
// `src` is supplied, otherwise a clearly-marked placeholder at a 16:9 ratio with
// the descriptive alt text — so a real capture can be dropped in later. Images
// lazy-load and always carry alt text.
export default function SupportImage({ src, alt, caption }) {
  if (src) {
    return (
      <figure>
        <img src={src} alt={alt} loading="lazy" decoding="async" />
        {caption && <figcaption>{caption}</figcaption>}
      </figure>
    )
  }
  return (
    <figure>
      <div className="img-ph" role="img" aria-label={alt}>
        <span className="ph-tag">Screenshot to come</span>
        <span className="ph-alt">{alt}</span>
      </div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  )
}
