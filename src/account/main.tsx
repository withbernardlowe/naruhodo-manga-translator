/**
 * 舊的帳號與訂閱頁（#213）：已經併進設定頁的 settings.html#account（#326）。外掛裡已經沒有地方連到這裡，
 * 只留著轉址，讓已經開著、被記下來或重新整理的分頁不會壞掉；?from=N 照樣帶過去（「回到漫畫」）。
 */
import { accountPath, accountRequest } from '../shared/account-page.ts';

location.replace(accountPath(accountRequest(location.search).from));
