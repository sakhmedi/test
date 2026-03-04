export default function Toast({ message, onClose }) {
  return (
    <div className="fixed top-4 right-4 z-50 animate-slide-in">
      <div className="bg-red-600 text-white text-sm px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 max-w-sm">
        <span className="flex-1">{message}</span>
        <button
          onClick={onClose}
          className="text-white/80 hover:text-white font-bold text-lg leading-none"
        >
          ×
        </button>
      </div>
    </div>
  );
}
