/* global window, document */

(function runPrototype() {
    const STORAGE_KEY = 'moodFoodProtoStateV1';
    const AUTH_DISABLED = true; // временно: авторизация не требуется

    const appEl = document.getElementById('app');
    const toastEl = document.getElementById('toast');

    const mock = (window.__MF_PROTO__ && window.__MF_PROTO__.mock) || {};
    const categories = mock.categories || [];
    const dishes = mock.dishes || [];
    const mockUser = mock.user || null;
    const employees = mock.employees || [];
    const shifts = mock.shifts || [];

    function nowIso() {
        return new Date().toISOString();
    }

    function id(prefix) {
        return `${prefix}-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
    }

    function formatMoneyRub(n) {
        return `${n} ₽`;
    }

    function escapeHtml(s) {
        return String(s)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function parseQuery(queryString) {
        const params = new URLSearchParams(queryString.startsWith('?') ? queryString.slice(1) : queryString);
        const out = {};
        params.forEach((value, key) => {
            out[key] = value;
        });
        return out;
    }

    function parseLocation() {
        const raw = window.location.hash || '#/login';
        const hash = raw.startsWith('#') ? raw.slice(1) : raw;
        const [pathPart, queryPart = ''] = hash.split('?');
        const path = pathPart || '/login';
        const query = parseQuery(queryPart);
        return {path, query};
    }

    function navigate(pathWithHash) {
        window.location.hash = pathWithHash.startsWith('#') ? pathWithHash : `#${pathWithHash}`;
    }

    function toast(message, type) {
        const prefix = type === 'ok' ? 'OK: ' : type === 'warn' ? 'Внимание: ' : type === 'err' ? 'Ошибка: ' : '';
        toastEl.textContent = `${prefix}${message}`;
        toastEl.classList.add('toast--show');
        window.clearTimeout(toast._t);
        toast._t = window.setTimeout(() => toastEl.classList.remove('toast--show'), 2400);
    }

    function loadState() {
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    function saveState(next) {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch (e) {
            // ignore
        }
    }

    function defaultState() {
        const tables = (mock.tables || []).map((t) => ({...t, guests: Array.isArray(t.guests) ? t.guests : []}));

        return {
            version: 1,
            authenticated: false,
            user: null,
            lastLoginEmail: '',
            resetSentTo: '',
            tables,
            orders: {}, // by tableId -> {openedAt, sentAt?, guests: {guestId: {items: [{dishId, qty, note}]}}}
            reservations: [], // post-MVP: [{id, tableId, date, time, guestsCount, name, status}]
            schedule: {
                employees,
                shifts
            }, // post-MVP: график смен/отчётность
            loyaltyMembers: mock.loyaltyMembers || [],
            ui: {
                pendingAdd: null // {tableId, guestId}
            }
        };
    }

    function normalizeState(loaded) {
        const base = defaultState();
        const s = loaded && typeof loaded === 'object' ? loaded : base;

        // Top-level
        s.version = 1;
        s.authenticated = Boolean(s.authenticated);
        s.user = s.user || null;
        s.lastLoginEmail = typeof s.lastLoginEmail === 'string' ? s.lastLoginEmail : '';
        s.resetSentTo = typeof s.resetSentTo === 'string' ? s.resetSentTo : '';

        // Tables
        s.tables = Array.isArray(s.tables) ? s.tables : base.tables;
        s.tables = s.tables.map((t, idx) => ({
            id: t?.id || `t-${idx + 1}`,
            number: t?.number ?? idx + 1,
            guests: Array.isArray(t?.guests) ? t.guests : []
        }));

        // Orders
        s.orders = s.orders && typeof s.orders === 'object' ? s.orders : {};
        Object.values(s.orders).forEach((order) => {
            if (!order || typeof order !== 'object') return;
            order.guests = order.guests && typeof order.guests === 'object' ? order.guests : {};
            if (!order.payment || typeof order.payment !== 'object') order.payment = {status: 'none', splitMode: 'byGuests'};
            Object.values(order.guests).forEach((g) => {
                if (!g || typeof g !== 'object') return;
                g.items = Array.isArray(g.items) ? g.items : [];
                g.items.forEach((it) => {
                    if (!it || typeof it !== 'object') return;
                    if (typeof it.qty !== 'number') it.qty = 1;
                    if (typeof it.note !== 'string') it.note = '';
                    if (typeof it.course !== 'number') it.course = 1;
                    if (typeof it.status !== 'string') it.status = order.sentAt ? 'cooking' : 'new';
                    if (typeof it.createdAt !== 'string') it.createdAt = order.openedAt || nowIso();
                });
            });
        });

        // post-MVP
        s.reservations = Array.isArray(s.reservations) ? s.reservations : [];
        s.schedule = s.schedule && typeof s.schedule === 'object' ? s.schedule : {};
        s.schedule.employees = Array.isArray(s.schedule.employees) ? s.schedule.employees : base.schedule.employees;
        s.schedule.shifts = Array.isArray(s.schedule.shifts) ? s.schedule.shifts : base.schedule.shifts;

        // Loyalty
        s.loyaltyMembers = Array.isArray(s.loyaltyMembers) ? s.loyaltyMembers : base.loyaltyMembers;

        // UI
        s.ui = s.ui && typeof s.ui === 'object' ? s.ui : {};
        s.ui.pendingAdd = s.ui.pendingAdd || null;

        return s;
    }

    let state = normalizeState(loadState());

    function setState(mutator) {
        const next = typeof mutator === 'function' ? mutator(structuredClone(state)) : mutator;
        state = next;
        saveState(state);
        render();
    }

    function getTableById(tableId) {
        return state.tables.find((t) => t.id === tableId);
    }

    function ensureOrder(tableId) {
        if (!state.orders[tableId]) {
            state.orders[tableId] = {
                openedAt: nowIso(),
                restaurantId: mockUser ? mockUser.restaurantId : 'r-000',
                tableNumber: (() => {
                    const t = getTableById(tableId);
                    return t ? t.number : null;
                })(),
                userId: mockUser ? mockUser.id : 'u-0',
                loyaltyMemberId: null,
                payment: {status: 'none', splitMode: 'byGuests'},
                guests: {}
            };
        }
        if (!state.orders[tableId].payment) state.orders[tableId].payment = {status: 'none', splitMode: 'byGuests'};
        return state.orders[tableId];
    }

    function ensureGuest(table, tableId) {
        const guestId = id('g');
        const guestNumber = (table.guests?.length || 0) + 1;
        const guest = {id: guestId, number: guestNumber, loyaltyMemberId: null};
        table.guests = [...(table.guests || []), guest];

        const order = ensureOrder(tableId);
        order.guests[guestId] = order.guests[guestId] || {items: []};

        return guest;
    }

    function computeTotals(tableId) {
        const order = state.orders[tableId];
        if (!order) return {sum: 0, itemsCount: 0};
        let sum = 0;
        let itemsCount = 0;
        Object.values(order.guests).forEach((g) => {
            (g.items || []).forEach((it) => {
                const dish = dishes.find((d) => d.id === it.dishId);
                const price = dish ? dish.price : 0;
                sum += price * (it.qty || 1);
                itemsCount += it.qty || 1;
            });
        });
        return {sum, itemsCount};
    }

    function getTodayYmd() {
        const d = new Date();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    function getTableStatus(tableId) {
        // post-MVP: свободен/заказ открыт/забронирован/ожидает оплату
        const order = state.orders[tableId];
        const totals = computeTotals(tableId);

        // 1) Ожидает оплату (если сформирован счет и есть сумма)
        if (order?.payment?.status === 'awaiting' && totals.sum > 0) return 'awaiting_payment';

        // 2) Открыт / отправлен
        if (order) return order.sentAt ? 'order_sent' : 'order_open';

        // 3) Забронирован (на сегодня, любой статус active)
        const today = getTodayYmd();
        const hasReservation = (state.reservations || []).some(
            (r) => r.tableId === tableId && r.date === today && (r.status || 'active') === 'active'
        );
        if (hasReservation) return 'reserved';

        return 'free';
    }

    function statusLabel(key) {
        switch (key) {
            case 'awaiting_payment':
                return 'Ожидает оплату';
            case 'order_sent':
                return 'Заказ отправлен';
            case 'order_open':
                return 'Заказ открыт';
            case 'reserved':
                return 'Забронирован';
            case 'free':
            default:
                return 'Свободен';
        }
    }

    function statusPillHtml(statusKey) {
        if (statusKey === 'awaiting_payment') return `<div class="pill pill--warn">Ожидает оплату</div>`;
        if (statusKey === 'order_sent') return `<div class="pill pill--ok">Отправлен</div>`;
        if (statusKey === 'order_open') return `<div class="pill">Открыт</div>`;
        if (statusKey === 'reserved') return `<div class="pill pill--info">Бронь</div>`;
        return `<div class="pill">Свободен</div>`;
    }

    function ScreenHeader({title, subtitle, backTo, rightHtml}) {
        const backBtn =
            backTo != null
                ? `<button class="btn btn--ghost" data-action="nav" data-to="${escapeHtml(backTo)}">Назад</button>`
                : '';
        const right = rightHtml || '';

        return `
            <div class="screen__header">
                <div class="screen__headerLeft">
                    ${backBtn}
                    <div style="min-width:0">
                        <h1 class="screen__title">${escapeHtml(title)}</h1>
                        ${subtitle ? `<p class="screen__subtitle">${escapeHtml(subtitle)}</p>` : ''}
                    </div>
                </div>
                ${right}
            </div>
        `;
    }

    function LoginScreen() {
        const email = state.lastLoginEmail || '';
        const emailLooksOk = /\S+@\S+\.\S+/.test(email);
        return `
            <div class="auth">
                ${ScreenHeader({title: 'Авторизация', subtitle: ''})}
                <div class="auth__spacer auth__spacer--top"></div>

                <form class="auth__form" data-action="login">
                    <label class="authField">
                        <div class="authField__meta">
                            <div class="authField__label">Email</div>
                            <input class="authField__input" name="email" type="email" value="${escapeHtml(
                                email
                            )}" placeholder="example@mail.com" />
                        </div>
                        <div class="authField__icon ${emailLooksOk ? 'authField__icon--ok' : ''}">${
                            emailLooksOk ? '✓' : ''
                        }</div>
                    </label>

                    <label class="authField">
                        <div class="authField__meta">
                            <div class="authField__label">Пароль</div>
                            <input class="authField__input" name="password" type="password" placeholder="••••••••" />
                        </div>
                        <div class="authField__icon authField__icon--empty"></div>
                    </label>

                    <button class="btn btn--primary btn--wide" type="submit">Войти</button>
                    <button class="link link--accent" type="button" data-action="nav" data-to="/forgot">Забыли пароль?</button>
                </form>

                <div class="auth__spacer auth__spacer--bottom"></div>
            </div>
        `;
    }

    function ForgotPasswordScreen() {
        return `
            <div class="screen">
                ${ScreenHeader({title: 'Восстановить доступ', subtitle: '', backTo: '/login'})}
                <div class="card">
                    <div class="hint">MVP: отправка временного пароля на почту (в прототипе — мок).</div>
                </div>
                <form class="form" data-action="reset">
                    <div class="field">
                        <div class="label">Email</div>
                        <input class="input" name="email" type="email" value="${escapeHtml(state.lastLoginEmail || '')}" placeholder="example@mail.com" required />
                    </div>
                    <div class="btnRow">
                        <button class="btn btn--primary btn--wide" type="submit">Отправить</button>
                        <button class="btn" type="button" data-action="nav" data-to="/login">Назад</button>
                    </div>
                </form>
                ${
                    state.resetSentTo
                        ? `<div class="card"><div class="ok">Временный пароль отправлен на: ${escapeHtml(
                              state.resetSentTo
                          )}</div><div class="hint">В прототипе это просто сообщение.</div></div>`
                        : ''
                }
            </div>
        `;
    }

    function HomeScreen() {
        const u = state.user;
        return `
            <div class="screen">
                ${ScreenHeader({
                    title: 'Главный экран',
                    subtitle: '',
                    rightHtml: `<button class="btn btn--ghost" data-action="logout">Выйти</button>`
                })}

                <div class="card">
                    <div class="card__title">Пользователь</div>
                    <div class="kv">
                        <div class="kv__row"><div class="kv__k">ФИО</div><div class="kv__v">${escapeHtml(
                            u.fullName
                        )}</div></div>
                        <div class="kv__row"><div class="kv__k">Роль</div><div class="kv__v">${escapeHtml(
                            u.role
                        )}</div></div>
                        <div class="kv__row"><div class="kv__k">ID</div><div class="kv__v">${escapeHtml(
                            u.id
                        )}</div></div>
                        <div class="kv__row"><div class="kv__k">Код ресторана</div><div class="kv__v">${escapeHtml(
                            u.restaurantCode
                        )}</div></div>
                    </div>
                </div>

                <div class="tiles">
                    <div class="tile" data-action="nav" data-to="/menu">
                        <div class="tile__title">Меню</div>
                        <p class="tile__desc">Актуальное меню + стоп‑лист</p>
                    </div>
                    <div class="tile" data-action="nav" data-to="/tables">
                        <div class="tile__title">Столы</div>
                        <p class="tile__desc">Гости, заказы, заметки для кухни</p>
                    </div>
                    <div class="tile" data-action="nav" data-to="/schedule">
                        <div class="tile__title">Расписание</div>
                        <p class="tile__desc">post‑MVP: график смен и отчётность</p>
                    </div>
                    <div class="tile" data-action="nav" data-to="/loyalty">
                        <div class="tile__title">Программа лояльности</div>
                        <p class="tile__desc">Поиск/регистрация участника</p>
                    </div>
                    <div class="tile" data-action="nav" data-to="/reservations">
                        <div class="tile__title">Бронирования</div>
                        <p class="tile__desc">post‑MVP: календарь и бронь столов</p>
                    </div>
                    <div class="tile" data-action="nav" data-to="/payments">
                        <div class="tile__title">Оплата</div>
                        <p class="tile__desc">post‑MVP: счёт и разделение</p>
                    </div>
                </div>

                <div class="card">
                    <div class="hint">Прототип: часть сценариев на мок‑данных, без бэкенда.</div>
                </div>
            </div>
        `;
    }

    function MenuCategoriesScreen(query) {
        const mode = query.mode || 'view';
        const pending = state.ui.pendingAdd;
        const subtitle = mode === 'add' && pending ? 'Добавление в заказ' : '';
        const backTo = mode === 'add' ? `/order?table=${encodeURIComponent(pending?.tableId || '')}&guest=${encodeURIComponent(pending?.guestId || '')}` : '/home';

        return `
            <div class="screen">
                ${ScreenHeader({title: 'Меню', subtitle, backTo})}
                <div class="list">
                    ${categories
                        .map(
                            (c) => `
                                <div class="row" data-action="nav" data-to="/menu/list?cat=${encodeURIComponent(
                                    c.id
                                )}${mode === 'add' ? '&mode=add' : ''}">
                                    <div class="row__main">
                                        <div class="row__title">${escapeHtml(c.title)}</div>
                                        <div class="row__meta">Категория</div>
                                    </div>
                                    <div class="pill">Открыть</div>
                                </div>
                            `
                        )
                        .join('')}
                </div>
            </div>
        `;
    }

    function MenuListScreen(query) {
        const catId = query.cat || categories[0]?.id;
        const mode = query.mode || 'view';
        const cat = categories.find((c) => c.id === catId);
        const items = dishes.filter((d) => d.categoryId === catId);

        const backTo = `/menu${mode === 'add' ? '?mode=add' : ''}`;
        const subtitle = mode === 'add' ? 'Выберите блюдо' : '';

        return `
            <div class="screen">
                ${ScreenHeader({title: cat ? cat.title : 'Меню', subtitle, backTo})}
                <div class="list">
                    ${items
                        .map((d) => {
                            const stop = d.isStopped;
                            const right = stop
                                ? `<div class="pill pill--stop">СТОП</div>`
                                : `<div class="pill">${formatMoneyRub(d.price)}</div>`;

                            const actionAttrs =
                                mode === 'add'
                                    ? `data-action="addDish" data-dish="${escapeHtml(d.id)}" ${stop ? 'aria-disabled="true"' : ''}`
                                    : `data-action="nav" data-to="/dish?id=${encodeURIComponent(d.id)}"`;

                            const meta = `${escapeHtml(d.portion)} · ~${escapeHtml(d.etaMin)} мин`;

                            return `
                                <div class="row" ${actionAttrs}>
                                    <div class="row__main">
                                        <div class="row__title">${escapeHtml(d.title)}</div>
                                        <div class="row__meta">${meta}</div>
                                    </div>
                                    ${right}
                                </div>
                            `;
                        })
                        .join('')}
                </div>
                <div class="card">
                    <div class="hint">
                        Блюда в стоп‑листе недоступны к добавлению в заказ (в прототипе — отключены).
                    </div>
                </div>
            </div>
        `;
    }

    function DishDetailsScreen(query) {
        const dishId = query.id;
        const d = dishes.find((x) => x.id === dishId);
        if (!d) {
            return `
                <div class="screen">
                    ${ScreenHeader({title: 'Блюдо', subtitle: 'Не найдено', backTo: '/menu'})}
                    <div class="card">Нет данных по блюду.</div>
                </div>
            `;
        }

        return `
            <div class="screen">
                ${ScreenHeader({title: d.title, subtitle: `${d.portion} · ~${d.etaMin} мин`, backTo: '/menu'})}
                <div class="card">
                    <div class="kv">
                        <div class="kv__row"><div class="kv__k">Цена</div><div class="kv__v">${formatMoneyRub(
                            d.price
                        )}</div></div>
                        <div class="kv__row"><div class="kv__k">Статус</div><div class="kv__v">${
                            d.isStopped ? '<span class="danger">СТОП</span>' : '<span class="ok">Доступно</span>'
                        }</div></div>
                    </div>
                </div>
                <div class="card">
                    <div class="card__title">Состав</div>
                    <div class="hint">${escapeHtml(d.ingredients.join(', '))}</div>
                </div>
                <div class="card">
                    <div class="card__title">Аллергены</div>
                    <div class="hint">${escapeHtml(d.allergens.length ? d.allergens.join(', ') : 'Нет')}</div>
                </div>
            </div>
        `;
    }

    function TablesScreen() {
        return `
            <div class="screen">
                ${ScreenHeader({title: 'Столы', subtitle: '', backTo: '/home'})}

                <div class="card">
                    <div class="card__title">MVP-допущение</div>
                    <div class="hint">
                        Для первой версии предусмотрен ручной ввод № стола (в прототипе — можно выбрать из списка ниже).
                    </div>
                </div>

                <div class="list">
                    ${state.tables
                        .map((t) => {
                            const guestsCount = (t.guests || []).length;
                            const totals = computeTotals(t.id);
                            const statusKey = getTableStatus(t.id);
                            const statusPill = statusPillHtml(statusKey);

                            return `
                                <div class="row" data-action="nav" data-to="/table?id=${encodeURIComponent(t.id)}">
                                    <div class="row__main">
                                        <div class="row__title">Стол №${escapeHtml(t.number)}</div>
                                        <div class="row__meta">Гостей: ${guestsCount} · Блюд: ${
                                totals.itemsCount
                            } · Сумма: ${formatMoneyRub(totals.sum)}</div>
                                    </div>
                                    ${statusPill}
                                </div>
                            `;
                        })
                        .join('')}
                </div>
            </div>
        `;
    }

    function TableDetailsScreen(query) {
        const tableId = query.id;
        const table = getTableById(tableId);
        if (!table) {
            return `
                <div class="screen">
                    ${ScreenHeader({title: 'Стол', subtitle: 'Не найден', backTo: '/tables'})}
                    <div class="card">Нет данных по столу.</div>
                </div>
            `;
        }

        const order = state.orders[tableId];
        const totals = computeTotals(tableId);
        const sent = Boolean(order?.sentAt);
        const statusKey = getTableStatus(tableId);

        const guestsHtml =
            (table.guests || []).length === 0
                ? `<div class="card"><div class="hint">Гостей пока нет. Нажмите “Добавить гостя”.</div></div>`
                : `
                    <div class="list">
                        ${(table.guests || [])
                            .map((g) => {
                                const member = state.loyaltyMembers.find((m) => m.id === g.loyaltyMemberId);
                                return `
                                    <div class="row">
                                        <div class="row__main">
                                            <div class="row__title">Гость ${escapeHtml(g.number)}</div>
                                            <div class="row__meta">${
                                                member
                                                    ? `ПЛ: ${escapeHtml(member.fullName)} · ${escapeHtml(member.id)}`
                                                    : 'ПЛ: не привязано'
                                            }</div>
                                        </div>
                                        <div class="btnRow">
                                            <button class="btn" data-action="nav" data-to="/loyalty?table=${encodeURIComponent(
                                                tableId
                                            )}&guest=${encodeURIComponent(g.id)}">Участник ПЛ</button>
                                            <button class="btn btn--primary" data-action="nav" data-to="/order?table=${encodeURIComponent(
                                                tableId
                                            )}&guest=${encodeURIComponent(g.id)}">Заказ</button>
                                        </div>
                                    </div>
                                `;
                            })
                            .join('')}
                    </div>
                `;

        return `
            <div class="screen">
                ${ScreenHeader({
                    title: `Стол №${table.number}`,
                    subtitle: `ID ресторана: ${escapeHtml(mockUser?.restaurantId || 'r-000')}`,
                    backTo: '/tables',
                    rightHtml: statusPillHtml(statusKey)
                })}

                <div class="card">
                    <div class="card__title">Итоги заказа</div>
                    <div class="kv">
                        <div class="kv__row"><div class="kv__k">Статус</div><div class="kv__v">${escapeHtml(
                            statusLabel(statusKey)
                        )}</div></div>
                        <div class="kv__row"><div class="kv__k">Блюд</div><div class="kv__v">${escapeHtml(
                            totals.itemsCount
                        )}</div></div>
                        <div class="kv__row"><div class="kv__k">Сумма</div><div class="kv__v">${formatMoneyRub(
                            totals.sum
                        )}</div></div>
                    </div>
                </div>

                <div class="actionsBar">
                    <button class="btn btn--primary" data-action="addGuest" data-table="${escapeHtml(tableId)}">Добавить гостя</button>
                    <button class="btn" data-action="openOrder" data-table="${escapeHtml(tableId)}">Открыть заказ</button>
                    ${
                        order
                            ? `<button class="btn btn--danger" data-action="resetTable" data-table="${escapeHtml(
                                  tableId
                              )}">Сбросить</button>`
                            : ''
                    }
                </div>

                ${guestsHtml}

                <div class="card">
                    <div class="card__title">Подсказка</div>
                    <div class="hint">
                        По фич-листу: при добавлении гостя открывается заказ гостя с возможностью добавления блюд.
                    </div>
                </div>
            </div>
        `;
    }

    function OrderScreen(query) {
        const tableId = query.table;
        const guestIdFromQuery = query.guest;
        const table = getTableById(tableId);
        if (!table) {
            return `
                <div class="screen">
                    ${ScreenHeader({title: 'Заказ', subtitle: 'Стол не найден', backTo: '/tables'})}
                    <div class="card">Нет данных по столу.</div>
                </div>
            `;
        }

        const order = ensureOrder(tableId);
        const guests = table.guests || [];
        const activeGuestId = guestIdFromQuery || guests[0]?.id;

        const totals = computeTotals(tableId);
        const sent = Boolean(order.sentAt);

        const tabsHtml =
            guests.length === 0
                ? `<div class="card"><div class="hint">Сначала добавьте гостя на экране стола.</div></div>`
                : `
                    <div class="tabs">
                        ${guests
                            .map((g) => {
                                const selected = g.id === activeGuestId;
                                return `<div class="tab" role="tab" aria-selected="${selected ? 'true' : 'false'}" data-action="nav" data-to="/order?table=${encodeURIComponent(
                                    tableId
                                )}&guest=${encodeURIComponent(g.id)}">Гость ${escapeHtml(g.number)}</div>`;
                            })
                            .join('')}
                    </div>
                `;

        const guest = guests.find((g) => g.id === activeGuestId);
        const guestOrder = activeGuestId ? order.guests[activeGuestId] || {items: []} : {items: []};

        const itemsHtml =
            !guest
                ? ''
                : guestOrder.items.length === 0
                  ? `<div class="card"><div class="hint">Блюд пока нет. Нажмите “Добавить блюда”.</div></div>`
                  : `
                        <div class="list">
                            ${guestOrder.items
                                .map((it, idx) => {
                                    const d = dishes.find((x) => x.id === it.dishId);
                                    const title = d ? d.title : it.dishId;
                                    const price = d ? d.price : 0;
                                    const sum = price * (it.qty || 1);
                                    return `
                                        <div class="itemCard">
                                            <div class="itemCard__top">
                                                <div style="min-width:0">
                                                    <div class="itemCard__title">${escapeHtml(title)}</div>
                                                    <div class="itemCard__meta">
                                                        <span class="price">${formatMoneyRub(price)}</span>
                                                        <span class="muted"> · </span>
                                                        <span class="muted">Кол‑во: ${escapeHtml(it.qty || 1)}</span>
                                                        <span class="muted"> · </span>
                                                        <span class="muted">Итого: ${formatMoneyRub(sum)}</span>
                                                    </div>
                                                </div>
                                                <div class="itemCard__badges">
                                                    ${dishStatusPill(it.status || 'new')}
                                                    <div class="pill">Подача ${escapeHtml(it.course || 1)}</div>
                                                    <button class="btn btn--ghost btn--sm" data-action="removeItem" data-table="${escapeHtml(
                                                        tableId
                                                    )}" data-guest="${escapeHtml(activeGuestId)}" data-idx="${escapeHtml(
                                        idx
                                    )}">Удалить</button>
                                                </div>
                                            </div>

                                            <div class="divider"></div>

                                            <div class="controlsGrid">
                                                <div class="field">
                                                    <div class="label">Подача</div>
                                                    <select class="select" data-action="setCourse" data-table="${escapeHtml(
                                                        tableId
                                                    )}" data-guest="${escapeHtml(activeGuestId)}" data-idx="${escapeHtml(idx)}" ${
                                                        sent ? 'disabled' : ''
                                                    }>
                                                        <option value="1" ${(it.course || 1) === 1 ? 'selected' : ''}>1</option>
                                                        <option value="2" ${(it.course || 1) === 2 ? 'selected' : ''}>2</option>
                                                        <option value="3" ${(it.course || 1) === 3 ? 'selected' : ''}>3</option>
                                                    </select>
                                                </div>
                                                <div class="field">
                                                    <div class="label">Статус</div>
                                                    <select class="select" data-action="setItemStatus" data-table="${escapeHtml(
                                                        tableId
                                                    )}" data-guest="${escapeHtml(activeGuestId)}" data-idx="${escapeHtml(idx)}">
                                                        <option value="new" ${(it.status || 'new') === 'new' ? 'selected' : ''}>${escapeHtml(
                                                            dishStatusLabel('new')
                                                        )}</option>
                                                        <option value="sent" ${(it.status || 'new') === 'sent' ? 'selected' : ''}>${escapeHtml(
                                                            dishStatusLabel('sent')
                                                        )}</option>
                                                        <option value="cooking" ${(it.status || 'new') === 'cooking' ? 'selected' : ''}>${escapeHtml(
                                                            dishStatusLabel('cooking')
                                                        )}</option>
                                                        <option value="ready" ${(it.status || 'new') === 'ready' ? 'selected' : ''}>${escapeHtml(
                                                            dishStatusLabel('ready')
                                                        )}</option>
                                                        <option value="served" ${(it.status || 'new') === 'served' ? 'selected' : ''}>${escapeHtml(
                                                            dishStatusLabel('served')
                                                        )}</option>
                                                    </select>
                                                </div>
                                            </div>

                                            <div class="field" style="margin-top:10px">
                                                <div class="label">Заметка для кухни</div>
                                                <textarea class="textarea" data-action="updateNote" data-table="${escapeHtml(
                                                    tableId
                                                )}" data-guest="${escapeHtml(activeGuestId)}" data-idx="${escapeHtml(
                                        idx
                                    )}" placeholder="Например: без лука, соус отдельно">${escapeHtml(it.note || '')}</textarea>
                                            </div>
                                        </div>
                                    `;
                                })
                                .join('')}
                        </div>
                    `;

        const headerSubtitleParts = [
            `Стол №${table.number}`,
            `Открыт: ${new Date(order.openedAt).toLocaleString('ru-RU')}`
        ];

        return `
            <div class="screen">
                ${ScreenHeader({
                    title: 'Заказ',
                    subtitle: headerSubtitleParts.join(' · '),
                    backTo: `/table?id=${encodeURIComponent(tableId)}`,
                    rightHtml: sent ? `<div class="pill pill--ok">Отправлен</div>` : ''
                })}

                ${tabsHtml}

                ${
                    guest
                        ? `
                            <div class="actionsBar">
                                <button class="btn btn--primary" data-action="startAdd" data-table="${escapeHtml(
                                    tableId
                                )}" data-guest="${escapeHtml(activeGuestId)}" ${sent ? 'disabled' : ''}>Добавить блюда</button>
                                <button class="btn btn--success" data-action="sendOrder" data-table="${escapeHtml(
                                    tableId
                                )}" ${sent ? 'disabled' : ''}>Направить заказ</button>
                                <button class="btn" data-action="simulateReady" data-table="${escapeHtml(
                                    tableId
                                )}" ${sent ? '' : 'disabled'}>Симулировать готовность</button>
                            </div>
                        `
                        : ''
                }

                ${itemsHtml}

                <div class="card">
                    <div class="card__title">Данные заказа</div>
                    <div class="kv">
                        <div class="kv__row"><div class="kv__k">ID ресторана</div><div class="kv__v">${escapeHtml(
                            order.restaurantId
                        )}</div></div>
                        <div class="kv__row"><div class="kv__k">№ стола</div><div class="kv__v">${escapeHtml(
                            order.tableNumber
                        )}</div></div>
                        <div class="kv__row"><div class="kv__k">ID пользователя</div><div class="kv__v">${escapeHtml(
                            order.userId
                        )}</div></div>
                        <div class="kv__row"><div class="kv__k">Блюд</div><div class="kv__v">${escapeHtml(
                            totals.itemsCount
                        )}</div></div>
                        <div class="kv__row"><div class="kv__k">Сумма</div><div class="kv__v">${formatMoneyRub(
                            totals.sum
                        )}</div></div>
                    </div>
                    <div class="hint">
                        MVP: “направить заказ” — мок‑успех. post‑MVP: можно менять статусы блюд и симулировать “пуш” о готовности.
                    </div>
                </div>
            </div>
        `;
    }

    function LoyaltySearchScreen(query) {
        const tableId = query.table || '';
        const guestId = query.guest || '';

        const contextSubtitle = tableId && guestId ? 'Привязка к гостю' : '';
        const backTo = tableId ? `/table?id=${encodeURIComponent(tableId)}` : '/home';

        return `
            <div class="screen">
                ${ScreenHeader({title: 'Программа лояльности', subtitle: contextSubtitle, backTo})}

                <form class="form" data-action="loyaltySearch">
                    <div class="field">
                        <div class="label">Телефон или № участника</div>
                        <input class="input" name="q" placeholder="+7 999… или pl-100023" />
                    </div>
                    <div class="btnRow">
                        <button class="btn btn--primary" type="submit">Найти</button>
                        <button class="btn" type="button" data-action="nav" data-to="/loyalty/register${tableId ? `?table=${encodeURIComponent(tableId)}&guest=${encodeURIComponent(guestId)}` : ''}">Регистрация</button>
                    </div>
                    ${
                        tableId && guestId
                            ? `<input type="hidden" name="table" value="${escapeHtml(tableId)}" /><input type="hidden" name="guest" value="${escapeHtml(
                                  guestId
                              )}" />`
                            : ''
                    }
                </form>

                <div class="card">
                    <div class="card__title">Результаты (мок)</div>
                    <div class="list">
                        ${state.loyaltyMembers
                            .map((m) => {
                                const subtitle = `${m.phone} · ${m.id}`;
                                const to = tableId && guestId ? `/loyalty/attach?member=${encodeURIComponent(m.id)}&table=${encodeURIComponent(tableId)}&guest=${encodeURIComponent(guestId)}` : `/loyalty/member?member=${encodeURIComponent(m.id)}`;
                                return `
                                    <div class="row" data-action="nav" data-to="${escapeHtml(to)}">
                                        <div class="row__main">
                                            <div class="row__title">${escapeHtml(m.fullName)}</div>
                                            <div class="row__meta">${escapeHtml(subtitle)}</div>
                                        </div>
                                        <div class="pill">Выбрать</div>
                                    </div>
                                `;
                            })
                            .join('')}
                    </div>
                </div>
            </div>
        `;
    }

    function LoyaltyMemberScreen(query) {
        const memberId = query.member;
        const m = state.loyaltyMembers.find((x) => x.id === memberId);
        if (!m) {
            return `
                <div class="screen">
                    ${ScreenHeader({title: 'Участник ПЛ', subtitle: 'Не найден', backTo: '/loyalty'})}
                    <div class="card">Нет данных.</div>
                </div>
            `;
        }

        return `
            <div class="screen">
                ${ScreenHeader({title: 'Участник ПЛ', subtitle: m.fullName, backTo: '/loyalty'})}
                <div class="card">
                    <div class="kv">
                        <div class="kv__row"><div class="kv__k">ID</div><div class="kv__v">${escapeHtml(m.id)}</div></div>
                        <div class="kv__row"><div class="kv__k">Телефон</div><div class="kv__v">${escapeHtml(
                            m.phone
                        )}</div></div>
                        <div class="kv__row"><div class="kv__k">E-mail</div><div class="kv__v">${escapeHtml(
                            m.email
                        )}</div></div>
                        <div class="kv__row"><div class="kv__k">Город</div><div class="kv__v">${escapeHtml(
                            m.city
                        )}</div></div>
                        <div class="kv__row"><div class="kv__k">Любимый ресторан</div><div class="kv__v">${escapeHtml(
                            m.favoriteRestaurant
                        )}</div></div>
                    </div>
                </div>
            </div>
        `;
    }

    function LoyaltyAttachScreen(query) {
        const memberId = query.member;
        const tableId = query.table;
        const guestId = query.guest;
        const member = state.loyaltyMembers.find((m) => m.id === memberId);
        const table = getTableById(tableId);
        const guest = table?.guests?.find((g) => g.id === guestId);

        if (!member || !table || !guest) {
            return `
                <div class="screen">
                    ${ScreenHeader({title: 'Привязка ПЛ', subtitle: 'Недостаточно данных', backTo: '/loyalty'})}
                    <div class="card">Не найден участник/стол/гость.</div>
                </div>
            `;
        }

        return `
            <div class="screen">
                ${ScreenHeader({title: 'Привязка ПЛ', subtitle: `Гость ${guest.number} · ${member.fullName}`, backTo: `/loyalty?table=${encodeURIComponent(tableId)}&guest=${encodeURIComponent(guestId)}`})}
                <div class="card">
                    <div class="hint">
                        Нажмите “Привязать”, чтобы записать ID участника к гостю (мок).
                    </div>
                    <div class="btnRow">
                        <button class="btn btn--primary" data-action="attachLoyalty" data-member="${escapeHtml(
                            memberId
                        )}" data-table="${escapeHtml(tableId)}" data-guest="${escapeHtml(guestId)}">Привязать</button>
                        <button class="btn" data-action="nav" data-to="/table?id=${encodeURIComponent(
                            tableId
                        )}">Вернуться к столу</button>
                    </div>
                </div>
                <div class="card">
                    <div class="card__title">Участник</div>
                    <div class="hint">${escapeHtml(member.id)} · ${escapeHtml(member.phone)}</div>
                </div>
            </div>
        `;
    }

    function LoyaltyRegisterScreen(query) {
        const tableId = query.table || '';
        const guestId = query.guest || '';
        const backTo = tableId ? `/loyalty?table=${encodeURIComponent(tableId)}&guest=${encodeURIComponent(guestId)}` : '/loyalty';

        return `
            <div class="screen">
                ${ScreenHeader({title: 'Регистрация в ПЛ', subtitle: 'MVP: форма + выдача карты/кошелёк', backTo})}
                <form class="form" data-action="loyaltyRegister">
                    <div class="field">
                        <div class="label">Фамилия и имя</div>
                        <input class="input" name="fullName" placeholder="Иванов Иван" required />
                    </div>
                    <div class="field">
                        <div class="label">Мобильный телефон</div>
                        <input class="input" name="phone" placeholder="+7 999 000-00-00" required />
                    </div>
                    <div class="field">
                        <div class="label">E-mail</div>
                        <input class="input" name="email" type="email" placeholder="guest@example.com" required />
                    </div>
                    <div class="field">
                        <div class="label">Возрастная группа</div>
                        <select class="select" name="ageGroup" required>
                            <option value="18-24">18–24</option>
                            <option value="25-34">25–34</option>
                            <option value="35-44">35–44</option>
                            <option value="45+">45+</option>
                        </select>
                    </div>
                    <div class="field">
                        <div class="label">Любимый ресторан сети</div>
                        <input class="input" name="favoriteRestaurant" placeholder="Mood & Food (…)" required />
                    </div>
                    <div class="field">
                        <div class="label">Город регистрации</div>
                        <input class="input" name="city" placeholder="Москва" required />
                    </div>
                    <div class="field">
                        <div class="label">После регистрации</div>
                        <select class="select" name="delivery" required>
                            <option value="card">Выдать карту со штрих‑кодом при посещении</option>
                            <option value="wallet">Направить ссылку в кошелёк телефона</option>
                        </select>
                    </div>
                    ${
                        tableId && guestId
                            ? `<input type="hidden" name="table" value="${escapeHtml(tableId)}" /><input type="hidden" name="guest" value="${escapeHtml(
                                  guestId
                              )}" />`
                            : ''
                    }
                    <div class="btnRow">
                        <button class="btn btn--primary" type="submit">Зарегистрировать</button>
                        <button class="btn" type="button" data-action="nav" data-to="${escapeHtml(backTo)}">Отмена</button>
                    </div>
                </form>
                <div class="card">
                    <div class="hint">
                        В прототипе регистрация создаёт мок‑участника и добавляет в список результатов.
                    </div>
                </div>
            </div>
        `;
    }

    function dishStatusLabel(status) {
        switch (status) {
            case 'sent':
                return 'Отправлено';
            case 'cooking':
                return 'Готовится';
            case 'ready':
                return 'Готово';
            case 'served':
                return 'Подано';
            case 'new':
            default:
                return 'Новое';
        }
    }

    function dishStatusPill(status) {
        if (status === 'ready') return `<div class="pill pill--ok">Готово</div>`;
        if (status === 'cooking') return `<div class="pill pill--info">Готовится</div>`;
        if (status === 'sent') return `<div class="pill">Отправлено</div>`;
        if (status === 'served') return `<div class="pill">Подано</div>`;
        return `<div class="pill">Новое</div>`;
    }

    function ReservationsScreen(query) {
        const date = query.date || getTodayYmd();
        const list = (state.reservations || []).filter((r) => r.date === date && (r.status || 'active') !== 'cancelled');

        return `
            <div class="screen">
                ${ScreenHeader({
                    title: 'Бронирования',
                    subtitle: '',
                    backTo: '/home',
                    rightHtml: `<button class="btn btn--primary" data-action="nav" data-to="/reservations/new?date=${encodeURIComponent(
                        date
                    )}">Новая бронь</button>`
                })}

                <form class="form" data-action="reservationsFilter">
                    <div class="field">
                        <div class="label">Дата</div>
                        <input class="input" name="date" type="date" value="${escapeHtml(date)}" />
                    </div>
                    <div class="btnRow">
                        <button class="btn" type="submit">Показать</button>
                    </div>
                </form>

                <div class="card">
                    <div class="card__title">Список</div>
                    ${
                        list.length === 0
                            ? `<div class="hint">На выбранную дату бронирований нет.</div>`
                            : `<div class="list">
                                ${list
                                    .map((r) => {
                                        const table = getTableById(r.tableId);
                                        return `
                                            <div class="row">
                                                <div class="row__main">
                                                    <div class="row__title">Стол №${escapeHtml(
                                                        table?.number ?? '?'
                                                    )} · ${escapeHtml(r.time)}</div>
                                                    <div class="row__meta">${escapeHtml(r.name)} · гостей: ${escapeHtml(
                                                        r.guestsCount
                                                    )}</div>
                                                </div>
                                                <button class="btn btn--ghost btn--sm" data-action="cancelReservation" data-res="${escapeHtml(
                                                    r.id
                                                )}">Отменить</button>
                                            </div>
                                        `;
                                    })
                                    .join('')}
                            </div>`
                    }
                </div>

                <div class="card">
                    <div class="hint">
                        В прототипе бронь влияет на статус стола “Бронь” (на сегодня) до отмены.
                    </div>
                </div>
            </div>
        `;
    }

    function ReservationsNewScreen(query) {
        const date = query.date || getTodayYmd();
        return `
            <div class="screen">
                ${ScreenHeader({title: 'Новая бронь', subtitle: '', backTo: `/reservations?date=${encodeURIComponent(date)}`})}

                <form class="form" data-action="createReservation">
                    <div class="field">
                        <div class="label">Дата</div>
                        <input class="input" name="date" type="date" value="${escapeHtml(date)}" required />
                    </div>
                    <div class="field">
                        <div class="label">Время</div>
                        <input class="input" name="time" type="time" value="19:00" required />
                    </div>
                    <div class="field">
                        <div class="label">Стол</div>
                        <select class="select" name="tableId" required>
                            ${(state.tables || [])
                                .map((t) => `<option value="${escapeHtml(t.id)}">Стол №${escapeHtml(t.number)}</option>`)
                                .join('')}
                        </select>
                    </div>
                    <div class="field">
                        <div class="label">Количество гостей</div>
                        <input class="input" name="guestsCount" type="number" min="1" value="2" required />
                    </div>
                    <div class="field">
                        <div class="label">Имя гостя</div>
                        <input class="input" name="name" placeholder="Иван" required />
                    </div>
                    <div class="btnRow">
                        <button class="btn btn--primary" type="submit">Создать бронь</button>
                        <button class="btn" type="button" data-action="nav" data-to="/reservations?date=${encodeURIComponent(
                            date
                        )}">Отмена</button>
                    </div>
                </form>
            </div>
        `;
    }

    function computeGuestTotalsForTable(tableId) {
        const table = getTableById(tableId);
        const order = state.orders[tableId];
        if (!table || !order) return [];
        const guests = table.guests || [];
        return guests.map((g) => {
            const items = order.guests?.[g.id]?.items || [];
            let sum = 0;
            items.forEach((it) => {
                const d = dishes.find((x) => x.id === it.dishId);
                const price = d ? d.price : 0;
                sum += price * (it.qty || 1);
            });
            return {guest: g, sum};
        });
    }

    function paymentStatusPill(order) {
        const s = order?.payment?.status || 'none';
        if (s === 'paid') return `<div class="pill pill--ok">Оплачен</div>`;
        if (s === 'awaiting') return `<div class="pill pill--warn">Ожидает оплату</div>`;
        return `<div class="pill">Нет</div>`;
    }

    function PaymentsScreen() {
        const rows = state.tables
            .map((t) => {
                const order = state.orders[t.id];
                const totals = computeTotals(t.id);
                if (!order && totals.sum === 0) return null;
                return {table: t, order, totals};
            })
            .filter(Boolean);

        return `
            <div class="screen">
                ${ScreenHeader({title: 'Оплата', subtitle: '', backTo: '/home'})}

                <div class="card">
                    <div class="card__title">Столы со счетами</div>
                    ${
                        rows.length === 0
                            ? `<div class="hint">Пока нет открытых заказов. Создайте заказ на столе.</div>`
                            : `<div class="list">
                                ${rows
                                    .map(({table, order, totals}) => {
                                        return `
                                            <div class="row" data-action="nav" data-to="/payments/table?id=${encodeURIComponent(
                                                table.id
                                            )}">
                                                <div class="row__main">
                                                    <div class="row__title">Стол №${escapeHtml(table.number)}</div>
                                                    <div class="row__meta">Сумма: ${formatMoneyRub(totals.sum)}</div>
                                                </div>
                                                ${paymentStatusPill(order)}
                                            </div>
                                        `;
                                    })
                                    .join('')}
                            </div>`
                    }
                </div>
            </div>
        `;
    }

    function PaymentsTableScreen(query) {
        const tableId = query.id;
        const table = getTableById(tableId);
        if (!table) {
            return `
                <div class="screen">
                    ${ScreenHeader({title: 'Оплата', subtitle: 'Стол не найден', backTo: '/payments'})}
                    <div class="card">Нет данных.</div>
                </div>
            `;
        }

        const order = ensureOrder(tableId);
        const totals = computeTotals(tableId);
        const guestTotals = computeGuestTotalsForTable(tableId);
        const splitMode = order.payment?.splitMode || 'byGuests';
        const guestsCount = Math.max(guestTotals.length, 1);
        const even = totals.sum > 0 ? Math.round((totals.sum / guestsCount) * 100) / 100 : 0;

        return `
            <div class="screen">
                ${ScreenHeader({
                    title: `Оплата — стол №${table.number}`,
                    subtitle: '',
                    backTo: '/payments',
                    rightHtml: paymentStatusPill(order)
                })}

                <div class="card">
                    <div class="card__title">Итоги</div>
                    <div class="kv kv--big">
                        <div class="kv__row"><div class="kv__k">Сумма</div><div class="kv__v">${formatMoneyRub(
                            totals.sum
                        )}</div></div>
                        <div class="kv__row"><div class="kv__k">Гостей</div><div class="kv__v">${escapeHtml(
                            guestTotals.length
                        )}</div></div>
                    </div>
                </div>

                <div class="card">
                    <div class="card__title">Счёт</div>
                    <div class="actionsBar">
                        <button class="btn btn--primary" data-action="makeBill" data-table="${escapeHtml(
                            tableId
                        )}" ${totals.sum === 0 ? 'disabled' : ''}>Сформировать счёт</button>
                        <button class="btn btn--success" data-action="markPaid" data-table="${escapeHtml(
                            tableId
                        )}" ${order.payment?.status !== 'awaiting' ? 'disabled' : ''}>Отметить оплату</button>
                    </div>
                    <div class="divider"></div>
                    <div class="field">
                        <div class="label">Разделить счёт</div>
                        <select class="select" data-action="setSplitMode" data-table="${escapeHtml(tableId)}">
                            <option value="byGuests" ${splitMode === 'byGuests' ? 'selected' : ''}>По гостям</option>
                            <option value="evenly" ${splitMode === 'evenly' ? 'selected' : ''}>Поровну</option>
                        </select>
                    </div>
                    <div class="hint">В прототипе разделение — расчётное (без печати/эквайринга).</div>
                </div>

                <div class="card">
                    <div class="card__title">Расчёт</div>
                    ${
                        splitMode === 'evenly'
                            ? `<div class="hint">Поровну: ${formatMoneyRub(even)} на гостя (${guestsCount}).</div>`
                            : `<div class="list">
                                ${guestTotals
                                    .map(
                                        ({guest, sum}) => `
                                            <div class="row">
                                                <div class="row__main">
                                                    <div class="row__title">Гость ${escapeHtml(guest.number)}</div>
                                                    <div class="row__meta">Сумма: ${formatMoneyRub(sum)}</div>
                                                </div>
                                                <div class="pill">По заказу</div>
                                            </div>
                                        `
                                    )
                                    .join('')}
                            </div>`
                    }
                </div>
            </div>
        `;
    }

    function parseTimeToMinutes(hhmm) {
        const [hh, mm] = String(hhmm || '00:00').split(':');
        const h = Number(hh);
        const m = Number(mm);
        if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
        return h * 60 + m;
    }

    function shiftDurationHours(shift) {
        const start = parseTimeToMinutes(shift.start);
        const end = parseTimeToMinutes(shift.end);
        const mins = Math.max(0, end - start);
        return Math.round((mins / 60) * 10) / 10;
    }

    function ScheduleScreen(query) {
        const date = query.date || getTodayYmd();
        const employeesById = new Map((state.schedule?.employees || []).map((e) => [e.id, e]));
        const list = (state.schedule?.shifts || []).filter((s) => s.date === date);

        return `
            <div class="screen">
                ${ScreenHeader({title: 'Расписание', subtitle: '', backTo: '/home'})}

                <form class="form" data-action="scheduleFilter">
                    <div class="field">
                        <div class="label">Дата</div>
                        <input class="input" name="date" type="date" value="${escapeHtml(date)}" />
                    </div>
                    <div class="btnRow">
                        <button class="btn" type="submit">Показать</button>
                    </div>
                </form>

                <div class="card">
                    <div class="card__title">Смены</div>
                    ${
                        list.length === 0
                            ? `<div class="hint">На эту дату смен нет (мок).</div>`
                            : `<div class="list">
                                ${list
                                    .map((s) => {
                                        const emp = employeesById.get(s.employeeId);
                                        const hours = shiftDurationHours(s);
                                        return `
                                            <div class="row" data-action="nav" data-to="/schedule/employee?id=${encodeURIComponent(
                                                s.employeeId
                                            )}">
                                                <div class="row__main">
                                                    <div class="row__title">${escapeHtml(emp?.fullName || s.employeeId)}</div>
                                                    <div class="row__meta">${escapeHtml(s.start)}–${escapeHtml(
                                            s.end
                                        )} · ${escapeHtml(hours)} ч</div>
                                                </div>
                                                <div class="pill">Отчёт</div>
                                            </div>
                                        `;
                                    })
                                    .join('')}
                            </div>`
                    }
                </div>
            </div>
        `;
    }

    function ScheduleEmployeeScreen(query) {
        const employeeId = query.id;
        const emp = (state.schedule?.employees || []).find((e) => e.id === employeeId);
        const list = (state.schedule?.shifts || []).filter((s) => s.employeeId === employeeId);
        const totalHours = list.reduce((acc, s) => acc + shiftDurationHours(s), 0);

        return `
            <div class="screen">
                ${ScreenHeader({
                    title: 'Отчётность',
                    subtitle: emp ? `${emp.fullName} · ${emp.role}` : employeeId,
                    backTo: '/schedule'
                })}

                <div class="card">
                    <div class="card__title">Итого</div>
                    <div class="kv">
                        <div class="kv__row"><div class="kv__k">Смен</div><div class="kv__v">${escapeHtml(
                            list.length
                        )}</div></div>
                        <div class="kv__row"><div class="kv__k">Часов</div><div class="kv__v">${escapeHtml(
                            totalHours
                        )}</div></div>
                    </div>
                    <div class="hint">В прототипе отчётность упрощена (без KPI/выручки).</div>
                </div>

                <div class="card">
                    <div class="card__title">Список смен</div>
                    ${
                        list.length === 0
                            ? `<div class="hint">Нет смен (мок).</div>`
                            : `<div class="list">
                                ${list
                                    .map((s) => {
                                        const hours = shiftDurationHours(s);
                                        return `
                                            <div class="row">
                                                <div class="row__main">
                                                    <div class="row__title">${escapeHtml(s.date)}</div>
                                                    <div class="row__meta">${escapeHtml(s.start)}–${escapeHtml(
                                            s.end
                                        )} · ${escapeHtml(hours)} ч</div>
                                                </div>
                                                <div class="pill">Смена</div>
                                            </div>
                                        `;
                                    })
                                    .join('')}
                            </div>`
                    }
                </div>
            </div>
        `;
    }

    function NotFoundScreen(path) {
        return `
            <div class="screen">
                ${ScreenHeader({title: 'Не найдено', subtitle: path, backTo: '/home'})}
                <div class="card">
                    <div class="hint">Маршрут не реализован в прототипе.</div>
                </div>
            </div>
        `;
    }

    function guard(route) {
        if (AUTH_DISABLED) return true;
        if (state.authenticated) return true;
        if (route.path === '/login' || route.path === '/forgot') return true;
        navigate('/login');
        return false;
    }

    function render() {
        const route = parseLocation();
        if (!guard(route)) return;

        let html = '';
        switch (route.path) {
            case '/login':
                html = LoginScreen();
                break;
            case '/forgot':
                html = ForgotPasswordScreen();
                break;
            case '/home':
                html = HomeScreen();
                break;
            case '/menu':
                html = MenuCategoriesScreen(route.query);
                break;
            case '/menu/list':
                html = MenuListScreen(route.query);
                break;
            case '/dish':
                html = DishDetailsScreen(route.query);
                break;
            case '/tables':
                html = TablesScreen();
                break;
            case '/table':
                html = TableDetailsScreen(route.query);
                break;
            case '/order':
                html = OrderScreen(route.query);
                break;
            case '/loyalty':
                html = LoyaltySearchScreen(route.query);
                break;
            case '/reservations':
                html = ReservationsScreen(route.query);
                break;
            case '/reservations/new':
                html = ReservationsNewScreen(route.query);
                break;
            case '/payments':
                html = PaymentsScreen();
                break;
            case '/payments/table':
                html = PaymentsTableScreen(route.query);
                break;
            case '/schedule':
                html = ScheduleScreen(route.query);
                break;
            case '/schedule/employee':
                html = ScheduleEmployeeScreen(route.query);
                break;
            case '/loyalty/register':
                html = LoyaltyRegisterScreen(route.query);
                break;
            case '/loyalty/member':
                html = LoyaltyMemberScreen(route.query);
                break;
            case '/loyalty/attach':
                html = LoyaltyAttachScreen(route.query);
                break;
            default:
                html = NotFoundScreen(route.path);
                break;
        }

        appEl.innerHTML = html;
    }

    function handleLogin(form) {
        const email = form.email.value.trim();
        setState((s) => {
            s.lastLoginEmail = email;
            s.authenticated = true;
            s.user = mockUser || {id: 'u-0', fullName: 'Пользователь', role: 'Роль', restaurantId: 'r-000', restaurantCode: 'MF-000'};
            s.resetSentTo = '';
            return s;
        });
        toast('Вход выполнен (мок)', 'ok');
        navigate('/home');
    }

    function handleReset(form) {
        const email = form.email.value.trim();
        setState((s) => {
            s.lastLoginEmail = email;
            s.resetSentTo = email;
            return s;
        });
        toast('Временный пароль отправлен (мок)', 'ok');
    }

    function handleLogout() {
        setState((s) => {
            s.authenticated = false;
            s.user = null;
            s.ui.pendingAdd = null;
            return s;
        });
        toast('Вы вышли', 'ok');
        navigate('/login');
    }

    function handleAddGuest(tableId) {
        setState((s) => {
            const table = s.tables.find((t) => t.id === tableId);
            if (!table) return s;
            const guest = ensureGuest(table, tableId);
            // По фич-листу: после добавления гостя открывается заказ гостя
            s.ui.pendingAdd = null;
            window.setTimeout(() => navigate(`/order?table=${encodeURIComponent(tableId)}&guest=${encodeURIComponent(guest.id)}`), 0);
            return s;
        });
        toast('Гость добавлен', 'ok');
    }

    function handleOpenOrder(tableId) {
        setState((s) => {
            ensureOrder(tableId);
            return s;
        });
        const table = getTableById(tableId);
        const firstGuest = table?.guests?.[0]?.id;
        navigate(`/order?table=${encodeURIComponent(tableId)}${firstGuest ? `&guest=${encodeURIComponent(firstGuest)}` : ''}`);
    }

    function handleResetTable(tableId) {
        setState((s) => {
            const table = s.tables.find((t) => t.id === tableId);
            if (table) table.guests = [];
            delete s.orders[tableId];
            s.ui.pendingAdd = null;
            return s;
        });
        toast('Стол сброшен', 'warn');
        navigate(`/table?id=${encodeURIComponent(tableId)}`);
    }

    function handleStartAdd(tableId, guestId) {
        setState((s) => {
            s.ui.pendingAdd = {tableId, guestId};
            return s;
        });
        navigate('/menu?mode=add');
    }

    function handleAddDish(dishId) {
        const pending = state.ui.pendingAdd;
        if (!pending) {
            toast('Не выбран контекст добавления', 'err');
            return;
        }
        const d = dishes.find((x) => x.id === dishId);
        if (!d) {
            toast('Блюдо не найдено', 'err');
            return;
        }
        if (d.isStopped) {
            toast('Блюдо в стоп‑листе', 'warn');
            return;
        }

        setState((s) => {
            const order = s.orders[pending.tableId] || ensureOrder(pending.tableId);
            order.guests[pending.guestId] = order.guests[pending.guestId] || {items: []};
            order.guests[pending.guestId].items.push({
                dishId,
                qty: 1,
                note: '',
                course: 1, // post-MVP: очередность подачи
                status: order.sentAt ? 'cooking' : 'new', // post-MVP: статус блюда
                createdAt: nowIso()
            });
            return s;
        });
        toast('Блюдо добавлено', 'ok');
        navigate(`/order?table=${encodeURIComponent(pending.tableId)}&guest=${encodeURIComponent(pending.guestId)}`);
    }

    function handleRemoveItem(tableId, guestId, idx) {
        setState((s) => {
            const order = s.orders[tableId];
            const g = order?.guests?.[guestId];
            if (!g) return s;
            g.items.splice(idx, 1);
            return s;
        });
        toast('Удалено', 'warn');
    }

    function handleUpdateNote(tableId, guestId, idx, note) {
        setState((s) => {
            const order = s.orders[tableId];
            const g = order?.guests?.[guestId];
            const it = g?.items?.[idx];
            if (!it) return s;
            it.note = note;
            return s;
        });
    }

    function handleSendOrder(tableId) {
        setState((s) => {
            const order = s.orders[tableId] || ensureOrder(tableId);
            order.sentAt = nowIso();
            // post-MVP: при отправке считаем, что кухня приняла заказ и блюда "готовятся"
            Object.values(order.guests || {}).forEach((g) => {
                (g.items || []).forEach((it) => {
                    if (!it.status || it.status === 'new' || it.status === 'sent') it.status = 'cooking';
                });
            });
            s.ui.pendingAdd = null;
            return s;
        });
        toast('Заказ направлен на кухню (мок)', 'ok');
        navigate(`/table?id=${encodeURIComponent(tableId)}`);
    }

    function handleSetCourse(tableId, guestId, idx, course) {
        setState((s) => {
            const order = s.orders[tableId];
            const it = order?.guests?.[guestId]?.items?.[idx];
            if (!it) return s;
            it.course = course;
            return s;
        });
    }

    function handleSetItemStatus(tableId, guestId, idx, status) {
        setState((s) => {
            const order = s.orders[tableId];
            const it = order?.guests?.[guestId]?.items?.[idx];
            if (!it) return s;
            it.status = status;
            return s;
        });
    }

    function handleSimulateReady(tableId) {
        let readyDishTitle = null;
        setState((s) => {
            const order = s.orders[tableId];
            if (!order) return s;
            // ищем первое блюдо, которое можно "довести" до готовности
            for (const guest of Object.values(order.guests || {})) {
                for (const it of guest.items || []) {
                    if (it.status === 'cooking' || it.status === 'sent') {
                        it.status = 'ready';
                        const d = dishes.find((x) => x.id === it.dishId);
                        readyDishTitle = d ? d.title : it.dishId;
                        return s;
                    }
                }
            }
            return s;
        });
        toast(readyDishTitle ? `Пуш (мок): готово — ${readyDishTitle}` : 'Нет блюд в готовке', readyDishTitle ? 'ok' : 'warn');
        // остаёмся на экране заказа
    }

    function handleCreateReservation(form) {
        const date = form.date.value;
        const time = form.time.value;
        const tableId = form.tableId.value;
        const guestsCount = Number(form.guestsCount.value || 0) || 1;
        const name = form.name.value.trim();

        let conflict = false;
        setState((s) => {
            conflict = (s.reservations || []).some(
                (r) => (r.status || 'active') === 'active' && r.tableId === tableId && r.date === date && r.time === time
            );
            if (conflict) return s;
            s.reservations = [
                {id: id('res'), tableId, date, time, guestsCount, name, status: 'active', createdAt: nowIso()},
                ...(s.reservations || [])
            ];
            return s;
        });

        if (conflict) {
            toast('На это время стол уже забронирован', 'err');
            return;
        }

        toast('Бронь создана', 'ok');
        navigate(`/reservations?date=${encodeURIComponent(date)}`);
    }

    function handleCancelReservation(resId) {
        setState((s) => {
            const r = (s.reservations || []).find((x) => x.id === resId);
            if (r) r.status = 'cancelled';
            return s;
        });
        toast('Бронь отменена', 'warn');
    }

    function handleMakeBill(tableId) {
        setState((s) => {
            const order = s.orders[tableId] || ensureOrder(tableId);
            order.payment = order.payment || {status: 'none', splitMode: 'byGuests'};
            order.payment.status = 'awaiting';
            order.payment.createdAt = nowIso();
            return s;
        });
        toast('Счёт сформирован', 'ok');
    }

    function handleMarkPaid(tableId) {
        setState((s) => {
            const order = s.orders[tableId];
            if (!order) return s;
            order.payment = order.payment || {status: 'none', splitMode: 'byGuests'};
            order.payment.status = 'paid';
            order.payment.paidAt = nowIso();
            return s;
        });
        toast('Оплата отмечена', 'ok');
    }

    function handleSetSplitMode(tableId, splitMode) {
        setState((s) => {
            const order = s.orders[tableId] || ensureOrder(tableId);
            order.payment = order.payment || {status: 'none', splitMode: 'byGuests'};
            order.payment.splitMode = splitMode;
            return s;
        });
    }

    function handleAttachLoyalty(memberId, tableId, guestId) {
        setState((s) => {
            const table = s.tables.find((t) => t.id === tableId);
            const guest = table?.guests?.find((g) => g.id === guestId);
            if (guest) guest.loyaltyMemberId = memberId;
            const order = s.orders[tableId];
            if (order) order.loyaltyMemberId = memberId;
            return s;
        });
        toast('Участник привязан', 'ok');
        navigate(`/table?id=${encodeURIComponent(tableId)}`);
    }

    function handleLoyaltyRegister(form) {
        const member = {
            id: `pl-${Math.floor(100000 + Math.random() * 900000)}`,
            fullName: form.fullName.value.trim(),
            phone: form.phone.value.trim(),
            email: form.email.value.trim(),
            city: form.city.value.trim(),
            favoriteRestaurant: form.favoriteRestaurant.value.trim(),
            ageGroup: form.ageGroup.value,
            delivery: form.delivery.value
        };

        const tableId = form.table?.value || '';
        const guestId = form.guest?.value || '';

        setState((s) => {
            s.loyaltyMembers = [member, ...s.loyaltyMembers];
            // Опционально: сразу привязать к гостю, если пришли из контекста стола
            if (tableId && guestId) {
                const table = s.tables.find((t) => t.id === tableId);
                const guest = table?.guests?.find((g) => g.id === guestId);
                if (guest) guest.loyaltyMemberId = member.id;
                const order = s.orders[tableId];
                if (order) order.loyaltyMemberId = member.id;
            }
            return s;
        });

        toast(member.delivery === 'wallet' ? 'Ссылка в кошелёк отправлена (мок)' : 'Карта будет выдана (мок)', 'ok');
        navigate(tableId ? `/table?id=${encodeURIComponent(tableId)}` : '/loyalty');
    }

    document.addEventListener('click', (e) => {
        const el = e.target.closest('[data-action]');
        if (!el) return;
        const action = el.getAttribute('data-action');
        if (!action) return;

        if (action === 'nav') {
            const to = el.getAttribute('data-to');
            if (to) navigate(to);
            return;
        }

        if (action === 'logout') {
            handleLogout();
            return;
        }

        if (action === 'addGuest') {
            handleAddGuest(el.getAttribute('data-table'));
            return;
        }

        if (action === 'openOrder') {
            handleOpenOrder(el.getAttribute('data-table'));
            return;
        }

        if (action === 'resetTable') {
            handleResetTable(el.getAttribute('data-table'));
            return;
        }

        if (action === 'startAdd') {
            handleStartAdd(el.getAttribute('data-table'), el.getAttribute('data-guest'));
            return;
        }

        if (action === 'addDish') {
            handleAddDish(el.getAttribute('data-dish'));
            return;
        }

        if (action === 'removeItem') {
            handleRemoveItem(el.getAttribute('data-table'), el.getAttribute('data-guest'), Number(el.getAttribute('data-idx')));
            return;
        }

        if (action === 'sendOrder') {
            handleSendOrder(el.getAttribute('data-table'));
            return;
        }

        if (action === 'simulateReady') {
            handleSimulateReady(el.getAttribute('data-table'));
            return;
        }

        if (action === 'cancelReservation') {
            handleCancelReservation(el.getAttribute('data-res'));
            return;
        }

        if (action === 'makeBill') {
            handleMakeBill(el.getAttribute('data-table'));
            return;
        }

        if (action === 'markPaid') {
            handleMarkPaid(el.getAttribute('data-table'));
            return;
        }

        if (action === 'attachLoyalty') {
            handleAttachLoyalty(el.getAttribute('data-member'), el.getAttribute('data-table'), el.getAttribute('data-guest'));
            return;
        }
    });

    document.addEventListener('input', (e) => {
        const el = e.target;
        if (!(el instanceof HTMLTextAreaElement)) return;
        if (el.getAttribute('data-action') !== 'updateNote') return;
        handleUpdateNote(el.getAttribute('data-table'), el.getAttribute('data-guest'), Number(el.getAttribute('data-idx')), el.value);
    });

    document.addEventListener('change', (e) => {
        const el = e.target;
        if (!(el instanceof HTMLSelectElement)) return;
        const action = el.getAttribute('data-action');
        if (!action) return;

        if (action === 'setCourse') {
            handleSetCourse(el.getAttribute('data-table'), el.getAttribute('data-guest'), Number(el.getAttribute('data-idx')), Number(el.value));
            toast('Очередность подачи обновлена', 'ok');
            return;
        }

        if (action === 'setItemStatus') {
            handleSetItemStatus(el.getAttribute('data-table'), el.getAttribute('data-guest'), Number(el.getAttribute('data-idx')), el.value);
            toast(`Статус блюда: ${dishStatusLabel(el.value)}`, 'ok');
            return;
        }

        if (action === 'setSplitMode') {
            handleSetSplitMode(el.getAttribute('data-table'), el.value);
            toast('Режим разделения счета обновлён', 'ok');
            return;
        }
    });

    document.addEventListener('submit', (e) => {
        const form = e.target;
        if (!(form instanceof HTMLFormElement)) return;
        const action = form.getAttribute('data-action');
        if (!action) return;
        e.preventDefault();

        if (action === 'login') {
            handleLogin(form);
            return;
        }

        if (action === 'reset') {
            handleReset(form);
            return;
        }

        if (action === 'loyaltySearch') {
            toast('Поиск выполнен (мок): список ниже', 'ok');
            return;
        }

        if (action === 'loyaltyRegister') {
            handleLoyaltyRegister(form);
            return;
        }

        if (action === 'createReservation') {
            handleCreateReservation(form);
            return;
        }

        if (action === 'reservationsFilter') {
            const date = form.date.value || getTodayYmd();
            navigate(`/reservations?date=${encodeURIComponent(date)}`);
            return;
        }

        if (action === 'scheduleFilter') {
            const date = form.date.value || getTodayYmd();
            navigate(`/schedule?date=${encodeURIComponent(date)}`);
            return;
        }
    });

    window.addEventListener('hashchange', () => render());

    if (!window.location.hash) {
        navigate('/login');
    } else {
        render();
    }
})();

