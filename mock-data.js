/* global window */

// Мок-данные для кликабельного прототипа.
// Никаких реальных интеграций — только сценарии из фич-листа.

(function attachMockData() {
    const categories = [
        {id: 'soups', title: 'Первые блюда'},
        {id: 'mains', title: 'Вторые блюда'},
        {id: 'seasonal', title: 'Сезонное предложение'},
        {id: 'desserts', title: 'Десерты'},
        {id: 'drinks', title: 'Напитки'},
        {id: 'alcohol', title: 'Алкоголь'}
    ];

    const dishes = [
        {
            id: 'd1',
            categoryId: 'soups',
            title: 'Том-ям с креветками',
            portion: '350 мл',
            price: 590,
            allergens: ['креветки', 'молочные продукты'],
            ingredients: ['креветки', 'кокосовое молоко', 'лайм', 'чили', 'грибы', 'лемонграсс'],
            etaMin: 15,
            isStopped: false
        },
        {
            id: 'd2',
            categoryId: 'soups',
            title: 'Борщ с говядиной',
            portion: '400 мл',
            price: 420,
            allergens: ['сельдерей'],
            ingredients: ['говядина', 'свёкла', 'капуста', 'сметана'],
            etaMin: 18,
            isStopped: true
        },
        {
            id: 'd3',
            categoryId: 'mains',
            title: 'Стейк из лосося',
            portion: '180 г',
            price: 980,
            allergens: ['рыба'],
            ingredients: ['лосось', 'лимон', 'масло', 'соль'],
            etaMin: 20,
            isStopped: false
        },
        {
            id: 'd4',
            categoryId: 'mains',
            title: 'Паста карбонара',
            portion: '320 г',
            price: 690,
            allergens: ['яйцо', 'молочные продукты', 'глютен'],
            ingredients: ['паста', 'бекон', 'сливки', 'пармезан'],
            etaMin: 17,
            isStopped: false
        },
        {
            id: 'd5',
            categoryId: 'desserts',
            title: 'Чизкейк классический',
            portion: '120 г',
            price: 390,
            allergens: ['молочные продукты', 'глютен'],
            ingredients: ['творожный сыр', 'печенье', 'масло'],
            etaMin: 8,
            isStopped: false
        },
        {
            id: 'd6',
            categoryId: 'drinks',
            title: 'Американо',
            portion: '250 мл',
            price: 190,
            allergens: [],
            ingredients: ['кофе', 'вода'],
            etaMin: 4,
            isStopped: false
        },
        {
            id: 'd7',
            categoryId: 'alcohol',
            title: 'Бокал красного вина',
            portion: '150 мл',
            price: 450,
            allergens: ['сульфиты'],
            ingredients: ['вино'],
            etaMin: 2,
            isStopped: false
        }
    ];

    const user = {
        id: 'u-4132',
        fullName: 'Иванова Мария',
        role: 'Официант',
        restaurantId: 'r-010',
        restaurantCode: 'MF-010',
        avatarInitials: 'МИ'
    };

    const tables = Array.from({length: 10}).map((_, i) => ({
        id: `t-${i + 1}`,
        number: i + 1,
        guests: []
    }));

    const loyaltyMembers = [
        {
            id: 'pl-100023',
            phone: '+7 999 111-22-33',
            email: 'guest1@example.com',
            fullName: 'Петров Алексей',
            city: 'Москва',
            favoriteRestaurant: 'Mood & Food (Тверская)'
        },
        {
            id: 'pl-100071',
            phone: '+7 999 222-33-44',
            email: 'guest2@example.com',
            fullName: 'Соколова Ольга',
            city: 'Санкт‑Петербург',
            favoriteRestaurant: 'Mood & Food (Невский)'
        }
    ];

    // post-MVP: расписание смен и отчётность
    const employees = [
        {id: 'u-4132', fullName: 'Иванова Мария', role: 'Официант'},
        {id: 'u-5120', fullName: 'Смирнов Артём', role: 'Официант'},
        {id: 'u-6001', fullName: 'Кузнецова Анна', role: 'Метрдотель'}
    ];

    // date: YYYY-MM-DD, start/end: HH:MM (локальное время)
    const shifts = [
        {id: 's-1', employeeId: 'u-4132', date: '2026-02-01', start: '12:00', end: '20:00'},
        {id: 's-2', employeeId: 'u-5120', date: '2026-02-01', start: '14:00', end: '22:00'},
        {id: 's-3', employeeId: 'u-6001', date: '2026-02-01', start: '10:00', end: '18:00'},
        {id: 's-4', employeeId: 'u-4132', date: '2026-02-02', start: '12:00', end: '20:00'}
    ];

    window.__MF_PROTO__ = {
        mock: {
            categories,
            dishes,
            user,
            tables,
            loyaltyMembers,
            employees,
            shifts
        }
    };
})();

