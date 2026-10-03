/** @typedef {'config'|'upload'|'results'} PageKey */

/**
 * @param {object} props
 * @param {PageKey} props.currentPage
 * @param {(page: PageKey) => void} props.onPageChange
 * @param {boolean} props.configSaved
 * @param {boolean} props.hasResults
 * @param {boolean} props.locked
 */
export default function Navigation({ currentPage, onPageChange, configSaved, hasResults, locked }) {
  /** @type {{ key: PageKey, label: string, description: string, done: boolean, disabled?: boolean }[]} */
  const buttons = [
    {
      key: 'config',
      label: '1. Cấu hình đề thi',
      description: configSaved ? 'Thiết lập câu hỏi và đáp án' : 'Cấu hình chưa được lưu — nhấn "Lưu cấu hình"',
      done: configSaved,
    },
    { key: 'upload', label: '2. Tải và xử lý ảnh', description: 'Nhận diện bài thi', done: hasResults, disabled: !configSaved },
    { key: 'results', label: '3. Kết quả', description: 'Xem điểm và xuất CSV', done: false, disabled: !hasResults },
  ];

  return (
    <div className="no-print bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex flex-col sm:flex-row gap-4">
        {buttons.map((button) => {
          const disabled = button.disabled || locked;
          return (
            <button
              key={button.key}
              onClick={() => !disabled && onPageChange(button.key)}
              disabled={disabled}
              title={locked ? 'Đang xử lý ảnh, vui lòng đợi...' : button.disabled ? 'Vui lòng hoàn thành bước trước' : ''}
              className={`flex-1 p-4 rounded-lg text-left transition-all duration-200 ${
                disabled
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed opacity-60'
                  : currentPage === button.key
                    ? 'bg-blue-600 text-white shadow-lg'
                    : 'bg-gray-50 hover:bg-gray-100 text-gray-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold text-lg">{button.label}</span>
                {button.done && (
                  <span className={`text-sm ${currentPage === button.key ? 'text-green-200' : 'text-green-600'}`}>
                    &#10003;
                  </span>
                )}
              </div>
              <div className={`text-sm mt-1 ${
                disabled ? 'text-gray-400' :
                currentPage === button.key ? 'text-blue-100' :
                button.key === 'config' && !configSaved ? 'text-amber-600 font-medium' : 'text-gray-500'
              }`}>
                {button.description}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
