import successLottie from '@/assets/lotties/success.json';

const SUCCESS_LOTTIE_GREEN_COLOR = '[0,0.788000009574,0.522000002394,1]';
const SUCCESS_LOTTIE_WHITE_COLOR = '[1,1,1,1]';

export const whiteSuccessLottie = JSON.parse(
  JSON.stringify(successLottie).replaceAll(SUCCESS_LOTTIE_GREEN_COLOR, SUCCESS_LOTTIE_WHITE_COLOR),
) as typeof successLottie;

export { successLottie };
