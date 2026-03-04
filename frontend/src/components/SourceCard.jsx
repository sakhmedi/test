export default function SourceCard({ filename, excerpt, page }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
      <p className="text-gray-600 text-xs font-medium mb-1 truncate">
        📄 {filename || 'Unknown file'}
        {page ? <span className="text-gray-400 ml-1">· p.{page}</span> : null}
      </p>
      {excerpt && (
        <p className="text-gray-500 text-xs italic line-clamp-2">"{excerpt}"</p>
      )}
    </div>
  );
}
