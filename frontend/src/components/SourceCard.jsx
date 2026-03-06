export default function SourceCard({ filename, excerpt, page }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
      <p className="text-gray-600 dark:text-gray-300 text-xs font-medium mb-1 truncate">
        📄 {filename || 'Unknown file'}
        {page ? <span className="text-gray-400 dark:text-gray-500 ml-1">· p.{page}</span> : null}
      </p>
      {excerpt && (
        <p className="text-gray-500 dark:text-gray-400 text-xs italic line-clamp-2">"{excerpt}"</p>
      )}
    </div>
  );
}
