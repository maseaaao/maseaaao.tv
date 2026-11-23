import type { YouTubeCategory } from './types';

function category(id: string, name: string): YouTubeCategory {
  return { id, name };
}

// Standard video categories returned by YouTube for the Russian locale.
// The Streamer.bot YouTube API accepts the category name, not the numeric id.
export const YOUTUBE_CATEGORIES: readonly YouTubeCategory[] = [
  // Gaming is first because every stream starts in this category.
  category('20', 'Видеоигры'),
  category('1', 'Фильмы и анимация'),
  category('2', 'Авто и транспорт'),
  category('10', 'Музыка'),
  category('15', 'Домашние животные и животные'),
  category('17', 'Спорт'),
  category('18', 'Короткометражные фильмы'),
  category('19', 'Путешествия и события'),
  category('21', 'Видеоблоги'),
  category('22', 'Люди и блоги'),
  category('23', 'Комедия'),
  category('24', 'Развлечения'),
  category('25', 'Новости и политика'),
  category('26', 'Практические советы и стиль'),
  category('27', 'Образование'),
  category('28', 'Наука и технологии'),
  category('29', 'НКО и активизм'),
  category('30', 'Кино'),
  category('31', 'Аниме и анимация'),
  category('32', 'Боевики и приключения'),
  category('33', 'Классика'),
  category('34', 'Комедийные фильмы'),
  category('35', 'Документальные фильмы'),
  category('36', 'Драма'),
  category('37', 'Семейные фильмы'),
  category('38', 'Зарубежные фильмы'),
  category('39', 'Ужасы'),
  category('40', 'Научная фантастика и фэнтези'),
  category('41', 'Триллеры'),
  category('42', 'Короткие ролики'),
  category('43', 'Шоу'),
  category('44', 'Трейлеры'),
];
