export default function MessageBubble({ role, content }) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-6`}>
      <div
        className={`text-base leading-relaxed whitespace-pre-wrap break-words ${
          isUser
            ? 'bg-gray-100 dark:bg-gray-700/80 text-gray-900 dark:text-gray-100 rounded-2xl rounded-br-md px-5 py-3 max-w-[78%]'
            : 'text-gray-800 dark:text-gray-100 max-w-[85%]'
        }`}
      >
        {content}
      </div>
    </div>
  );
}
