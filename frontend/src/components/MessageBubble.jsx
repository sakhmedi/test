export default function MessageBubble({ role, content }) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      {!isUser && (
        <div className="w-7 h-7 bg-[#1a56db] rounded-full flex items-center justify-center mr-2 flex-shrink-0 mt-0.5">
          <span className="text-white text-xs font-bold">D</span>
        </div>
      )}
      <div
        className={`max-w-[75%] text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? 'bg-[#1a56db] text-white rounded-2xl rounded-br-sm px-4 py-3'
            : 'text-gray-800'
        }`}
      >
        {content}
      </div>
    </div>
  );
}
