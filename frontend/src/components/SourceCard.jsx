export default function SourceCard({ filename, excerpt, page }) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 text-xs">
      <p className="text-sky-400 font-medium mb-1 truncate">
        {filename || 'Unknown file'}
        {page ? <span className="text-slate-500 ml-1">· p.{page}</span> : null}
      </p>
      <p className="text-slate-400 line-clamp-3">{excerpt}</p>
    </div>
  );
}
