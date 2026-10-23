import { createSSRApp } from 'vue';
import CounterCard from './CounterCard.vue';

createSSRApp(CounterCard).mount('#app');
