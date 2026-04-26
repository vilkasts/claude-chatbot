// Three pulsing dots inside a bot-styled bubble. Shown only between the
// moment the user sends and the first chunk of the model's reply. The
// animation lives in styles.css (@keyframes blink).
export const TypingIndicator = () => (
  <div className="bubble-row bubble-row--bot">
    <div className="bubble bubble--bot bubble--typing" aria-label="Бот думает">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
    </div>
  </div>
);
