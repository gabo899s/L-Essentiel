import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ShoppingCart, ArrowLeft, Trash2, Plus, Minus, Search, Heart, User as UserIcon, X, LogOut, Settings, CreditCard, MessageCircle, Send, Star, Clock, Image as ImageIcon, Sparkles, Menu } from 'lucide-react';
import { collection, onSnapshot, doc, setDoc, getDoc, updateDoc, arrayUnion, arrayRemove, addDoc, deleteDoc, query, orderBy, where, serverTimestamp } from 'firebase/firestore';
import { GoogleAuthProvider, TwitterAuthProvider, signInWithPopup, onAuthStateChanged, signOut, User, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { GoogleGenAI } from "@google/genai";
import { db, auth } from './firebase';

let geminiClient: GoogleGenAI | null = null;
const getAi = () => {
   if (!geminiClient) {
      const key = process.env.GEMINI_API_KEY;
      if (!key) {
         console.error("GEMINI_API_KEY no disponible localmente. Conectando vía proxy seguro del servidor.");
         // Fallback devuelto para usar el proxy del backend (Hyperlift)
         return {
           models: {
              generateContent: async (params: any) => {
                 try {
                     const res = await fetch('/api/gemini-proxy', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ params })
                     });
                     if (!res.ok) throw new Error("Proxy response failed");
                     const json = await res.json();
                     return { text: json.text };
                 } catch (err) {
                     console.error("Proxy routing falló", err);
                     import('sonner').then(({ toast }) => toast.error('No pudimos conectar con nuestro sistema de Inteligencia Artificial.', { description: 'Intenta nuevamente en unos instantes.' }));
                     return { text: '[]' };
                 }
              }
           }
         } as unknown as GoogleGenAI;
      }
      geminiClient = new GoogleGenAI({ apiKey: key });
   }
   return geminiClient;
};

// Getter global 'ai' con proxy para evitar re-factoreos masivos.
const ai = new Proxy({} as GoogleGenAI, {
  get: (target, prop) => {
    return (getAi() as any)[prop];
  }
});
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";
import { Toaster } from "sonner";
import { OrderTracking } from "@/components/ui/order-tracking";
import { UserProfileSidebar } from "@/components/ui/menu";
import { ProductCard } from "@/components/ui/card-19";
import { DeliveryScheduler } from "@/components/ui/delivery-scheduler";
import { motion, AnimatePresence } from 'motion/react';
import { Helmet, HelmetProvider } from 'react-helmet-async';

import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix for default Leaflet icons in Webpack/Vite
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// --- TYPES ---
type Review = { id: string; userId: string; userName: string; rating: number; text: string; date: string };
export type ProductStatus = 'published' | 'draft' | 'hidden';

export type ProductVariant = {
  id: string;
  name: string;
  sku: string;
  price: number;
  stock: number;
};
export type TieredPrice = { quantity: number; price: number; };
export type CustomInput = { id: string; label: string; type: 'text' | 'select' | 'file'; options?: string; required: boolean; };

export type Product = { 
  id: string; 
  name: string; 
  price: number; 
  compareAtPrice?: number;
  costPrice?: number;
  category: string; 
  image: string; 
  images?: string[];
  description: string;
  sizes?: string[];
  colors?: string[];
  stock: number;
  reviews?: Review[];
  sku?: string;
  barcode?: string;
  status?: ProductStatus;
  slug?: string;
  metaTitle?: string;
  metaDescription?: string;
  brand?: string;
  tags?: string[];
  weight?: number;
  dimensions?: { length: number; width: number; height: number };
  isDigital?: boolean;
  minPurchaseQuantity?: number;
  maxPurchaseQuantity?: number;
  variants?: ProductVariant[];
  relatedProductIds?: string[];
  tieredPrices?: TieredPrice[];
  customInputs?: CustomInput[];
};
type CartItem = { product: Product; quantity: number; size?: string; color?: string };

type Promo = { id: string; code: string; discountPercent: number; active: boolean; type: 'promo' | 'giftcard' };
type StoreConfig = { taxRate: number };

type ViewState = 'home' | 'product' | 'cart' | 'about' | 'shipping' | 'terms' | 'profile' | 'admin';

type ChatMessage = { id: string; sender: 'user' | 'ai' | 'admin'; text: string; timestamp: Date; isImage?: boolean; imageUrl?: string };
type Chat = { 
  id: string; 
  userId: string; 
  userEmail: string; 
  status: 'active_ai' | 'waiting_human' | 'active_human' | 'closed'; 
  messages: ChatMessage[]; 
  rating?: number; 
  assignedAdmin?: string; 
  updatedAt: Date 
};

// --- FALLBACK DATA (In case DB is empty on first load) ---
const INITIAL_PRODUCTS: Product[] = [
  {
    id: '1',
    name: 'Vestido Seda Cruda',
    price: 185,
    category: 'Indumentaria',
    image: 'https://picsum.photos/seed/silk/800/1000',
    description: 'Fluidez y elegancia en su estado más puro. Este vestido de seda cruda se adapta perfectamente a la silueta con un corte minimalista.',
    sizes: ['S', 'M', 'L'],
    stock: 12,
    reviews: []
  },
  {
    id: '2',
    name: 'Bolso Cuero Neutro',
    price: 240,
    category: 'Accesorios',
    image: 'https://picsum.photos/seed/leather/800/1000',
    description: 'Hecho a mano por artesanos locales. Su interior espacioso y diseño estructurado lo hacen el complemento perfecto para el día a día.',
    sizes: ['Única'],
    stock: 5,
    reviews: []
  },
  {
    id: '3',
    name: 'Vela Aromática',
    price: 45,
    category: 'Hogar',
    image: 'https://picsum.photos/seed/candle/800/1000',
    description: 'Notas de sándalo y vainilla cálida. Creada para transformar espacios en santuarios de paz y minimalismo.',
    sizes: ['Única'],
    stock: 0, // Agotado para prueba
    reviews: []
  },
  {
    id: '4',
    name: 'Zapatos Oxford',
    price: 130,
    category: 'Calzado',
    image: 'https://picsum.photos/seed/shoes/800/1000',
    description: 'Un clásico reinventado. Minimalismo en cada punzada para ofrecer máxima comodidad y estilo atemporal.',
    sizes: ['38', '39', '40', '41'],
    stock: 8,
    reviews: []
  }
];

export default function App() {
  const [view, setView] = useState<ViewState>('home');
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  // Filtering state
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [activeSize, setActiveSize] = useState<string>('All');
  const [activeColor, setActiveColor] = useState<string>('All');
  const categories = ['All', ...Array.from(new Set(products.map(p => p.category)))];
  const availableSizes = useMemo(() => ['All', ...Array.from(new Set(products.flatMap(p => p.sizes || []).filter(s => s !== 'Única')))], [products]);
  const availableColors = useMemo(() => ['All', ...Array.from(new Set(products.flatMap(p => p.colors || [])))], [products]);

  // Auth & Profile State
  const [user, setUser] = useState<User | null>(null);
  const [isVerified, setIsVerified] = useState<boolean>(true);
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'otp'>('login');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [orders, setOrders] = useState<any[]>([]);

  // Search & Sort State
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSearchingAI, setIsSearchingAI] = useState(false);
  const [aiSearchResults, setAiSearchResults] = useState<Product[] | null>(null);
  const [sortBy, setSortBy] = useState<'new'|'price-asc'|'price-desc'>('new');

  // Checkout & Payment State
  const [showPaymentOptions, setShowPaymentOptions] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [addressStr, setAddressStr] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [discountPercent, setDiscountPercent] = useState(0);

  // Profile Tracking
  const [trackingOrderId, setTrackingOrderId] = useState<string | null>(null);
  const [trackingCoords, setTrackingCoords] = useState<{lat: number, lng: number} | null>(null);
  const [isTrackingLoading, setIsTrackingLoading] = useState(false);

  // Admin Config & Promos
  const [promos, setPromos] = useState<Promo[]>([]);
  const [storeConfig, setStoreConfig] = useState<StoreConfig>({ taxRate: 0 });

  // Admin Chats State
  const [adminActiveChats, setAdminActiveChats] = useState<Chat[]>([]);
  const [viewingChat, setViewingChat] = useState<Chat | null>(null);
  const [adminChatInput, setAdminChatInput] = useState('');

  // --- ORDER PROCESSING ---
  const processSuccessfulOrder = async (method: string, transactionId: string) => {
    const finalEmail = user ? user.email : guestEmail;
    
    if (!user && !finalEmail?.trim()) { showToast("Por favor ingresa un correo para recibir tu recibo."); return; }
    if (!addressStr.trim()) { showToast("Por favor ingresa una dirección de envío completa."); return; }
    
    setIsProcessingPayment(true);
    showToast('Validando pago...');
    
    try {
      const baseTotal = cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
      const withDiscount = discountPercent > 0 ? baseTotal * (1 - (discountPercent/100)) : baseTotal;
      const cartTotal = withDiscount * (1 + (storeConfig.taxRate / 100));
      
      const orderData = {
        userId: user ? user.uid : 'guest',
        userEmail: finalEmail,
        items: JSON.stringify(cart),
        total: cartTotal,
        paymentMethod: method,
        transactionId: transactionId,
        status: 'pagado',
        createdAt: new Date().toISOString(),
        address: addressStr,
        discount: discountPercent > 0 ? couponCode : null
      };

      // Substract Stock
      for (const item of cart) {
         if (typeof item.product.stock === 'number') {
           const productRef = doc(db, 'products', item.product.id);
           const snap = await getDoc(productRef);
           if (snap.exists()) {
             const proData = snap.data();
             await updateDoc(productRef, { stock: Math.max(0, (proData.stock || 0) - item.quantity) });
           }
         }
      }

      // Save to firestore
      await addDoc(collection(db, 'orders'), orderData);
      
      // Format HTML items
      const itemsHtml = cart.map(item => `
        <tr>
          <td style="padding: 15px 0; border-bottom: 1px solid #f0f0f0;">
            <div style="font-weight: bold; color: #1a1a1a; margin-bottom: 5px;">${item.product.name} (Talla: ${item.size || 'Única'} ${item.color ? '- Color: ' + item.color : ''})</div>
            <div style="font-size: 12px; color: #8e8e8e; text-transform: uppercase; letter-spacing: 1px;">Cantidad: ${item.quantity}</div>
          </td>
          <td style="padding: 15px 0; border-bottom: 1px solid #f0f0f0; text-align: right; font-family: Georgia, serif; font-style: italic; color: #1a1a1a;">
            $${(item.product.price * item.quantity).toFixed(2)}
          </td>
        </tr>
      `).join('');

      // Send confirmation email
      await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
           to: user.email,
           fromType: 'team',
           subject: 'Confirmación de Pedido (Pagado) - L\'Essentiel',
           text: `Hemos recibido tu pedido por $${cartTotal.toFixed(2)}.`,
           html: `
              <div style="background-color: #F5F5F0; padding: 60px 20px; font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; line-height: 1.6;">
                <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 60px 40px; border: 1px solid #eeeeee;">
                  <h1 style="font-family: Georgia, serif; font-style: italic; font-weight: normal; font-size: 32px; text-align: center; margin: 0 0 10px 0;">L'Essentiel</h1>
                  <p style="text-align: center; font-size: 12px; text-transform: uppercase; letter-spacing: 3px; color: #8e8e8e; margin: 0 0 40px 0;">Recibo de compra</p>
                  
                  <p style="font-size: 15px; color: #4a4a4a; margin-bottom: 10px;">Hola, ${user.displayName || ''}</p>
                  <p style="font-size: 15px; color: #4a4a4a; margin-bottom: 20px;">Tu pago mediante <strong>${method}</strong> ha sido confirmado y procesado con éxito. Aquí tienes el resumen de tu compra:</p>
                  <p style="font-size: 15px; color: #4a4a4a; margin-bottom: 40px;">Envío a: <strong>${addressStr}</strong></p>
                  
                  <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
                    ${itemsHtml}
                    ${discountPercent > 0 ? `
                        <tr>
                          <td style="padding: 15px 0 10px 0; font-weight: bold; text-transform: uppercase; font-size: 11px; letter-spacing: 2px;">Descuento (${couponCode})</td>
                          <td style="padding: 15px 0 10px 0; text-align: right; color: #1a1a1a;">
                            -${discountPercent}%
                          </td>
                        </tr>
                    ` : ''}
                    <tr>
                      <td style="padding: 25px 0 10px 0; font-weight: bold; text-transform: uppercase; font-size: 12px; letter-spacing: 2px;">Total</td>
                      <td style="padding: 25px 0 10px 0; text-align: right; font-family: Georgia, serif; font-style: italic; font-size: 20px;">
                        $${cartTotal.toFixed(2)}
                      </td>
                    </tr>
                  </table>
                  <p style="font-size: 12px; text-align: center; color: #8e8e8e;">Ref: ${transactionId}</p>
                  <p style="font-size: 13px; line-height: 1.6; color: #8e8e8e; text-align: center; margin-top: 50px; padding-top: 30px; border-top: 1px solid #f0f0f0;">Tu pedido está siendo preparado para ser enviado pronto.<br/>Te notificaremos sobre cualquier avance.</p>
                </div>
              </div>
           `
        })
      });
      
      setCart([]);
      setShowPaymentOptions(false);
      setIsProcessingPayment(false);
      setDiscountPercent(0);
      setCouponCode('');
      setAddressStr('');
      showToast('¡Pago exitoso! Correo de confirmación enviado.');
      setView('profile');
      
    } catch (e) {
      console.error(e);
      showToast('Error registrando tu compra. Contáctanos.');
      setIsProcessingPayment(false);
    }
  };

  const handleTilopayCheckout = async () => {
    if (!user) return;
    if (!addressStr.trim()) { showToast("Por favor ingresa una dirección de envío completa."); return; }

    setIsProcessingPayment(true);
    showToast('Conectando con plataforma de pago...');
    
    try {
      const baseTotal = cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
      const withDiscount = discountPercent > 0 ? baseTotal * (1 - (discountPercent/100)) : baseTotal;
      const cartTotal = withDiscount * (1 + (storeConfig.taxRate / 100));

      const res = await fetch('/api/tilopay/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: cartTotal,
          orderId: 'TILO-ORD-' + Date.now(),
          email: user.email
        })
      });
      
      const data = await res.json();
      
      if (data.success) {
         // Si url está presente, deberíamos redirigir: window.location.href = data.url;
         // En entorno de vista previa (SIMULACIÓN):
         setTimeout(() => {
            processSuccessfulOrder('Tarjeta (Tilopay)', data.transactionId);
         }, 2000);
      } else {
         throw new Error(data.error);
      }
    } catch (e: any) {
      import('sonner').then(({ toast }) => toast.error('Error al procesar el pago', { description: e?.message || 'No pudimos conectar con la plataforma de pago. Por favor intenta más tarde.' }));
      setIsProcessingPayment(false);
    }
  };

  // --- PUSH NOTIFICATIONS ---
  useEffect(() => {
    const pushTimer = setTimeout(() => {
      // Pedimos permiso si nunca se ha pedido y simulamos suscripción
      if (Notification.permission === 'default') {
         if (window.confirm('¿Deseas recibir notificaciones push para nuevas colecciones y promociones?')) {
            Notification.requestPermission().then(p => {
              if (p === 'granted') {
                new Notification("L'Essentiel", {
                  body: "¡Gracias por suscribirte a nuestras notificaciones!",
                  icon: "https://picsum.photos/seed/leather/200/200"
                });
              }
            });
         }
      } else if (Notification.permission === 'granted') {
         setTimeout(() => {
           new Notification("L'Essentiel", {
             body: "¡Han llegado nuevos productos exclusivos a la tienda que podrían encantarte!",
             icon: "https://picsum.photos/seed/silk/200/200"
           });
         }, Math.random() * 60000 + 30000); // Random push simulation later
      }
    }, 15000); // Ask after 15 seconds

    return () => clearTimeout(pushTimer);
  }, []);

  // --- FIREBASE SETUP AND BOOTSTRAP ---
  useEffect(() => {
    // Attempt connections and load data...
    const unsubscribe = onSnapshot(collection(db, 'products'), 
      (snapshot) => {
        if (snapshot.empty) {
          console.log("No products found in DB. You can bootstrap initial products via admin.");
          // For the preview, we'll keep the UI populated if the DB is truly empty 
          // (or we can auto-bootstrap them for testing if you wanted)
          setProducts(INITIAL_PRODUCTS);
        } else {
          const dbProducts = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })) as Product[];
          setProducts(dbProducts);
        }
      },
      (error) => {
        console.error("Firestore onSnapshot Error:", error);
        import('sonner').then(({ toast }) => toast.error('No se pudieron cargar los productos correctamente.', { description: 'Revisando tu conexión o inténtalo más tarde.' }));
        setProducts(INITIAL_PRODUCTS); // Fallback on db error
      }
    );

    return () => unsubscribe();
  }, []);

  // --- AUTH & WISHLIST LISTENER ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        let currentIsVerified = true;
        const userRef = doc(db, 'users', currentUser.uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          const isPassword = currentUser.providerData.some(p => p.providerId === 'password');
          currentIsVerified = !isPassword;
          setIsVerified(currentIsVerified);
          await setDoc(userRef, {
            uid: currentUser.uid,
            displayName: currentUser.displayName || currentUser.email?.split('@')[0] || 'Usuario',
            email: currentUser.email || '',
            addresses: [],
            isVerified: currentIsVerified
          });
          if (isPassword) {
             setShowLoginModal(true);
             setAuthMode('otp');
          }
        } else {
          currentIsVerified = userSnap.data().isVerified !== false;
          setIsVerified(currentIsVerified);
          if (!currentIsVerified) {
             setShowLoginModal(true);
             setAuthMode('otp');
          }
        }
        
        const wlUnsub = onSnapshot(doc(db, 'wishlists', currentUser.uid), (wlSnap) => {
          if (wlSnap.exists()) {
            setWishlist(wlSnap.data().productIds || []);
          } else {
            setDoc(doc(db, 'wishlists', currentUser.uid), { uid: currentUser.uid, productIds: [] });
            setWishlist([]);
          }
        });
        
        const q = query(collection(db, 'orders'), where('userId', '==', currentUser.uid));
        const ordersUnsub = onSnapshot(q, (ordSnap) => {
           setOrders(ordSnap.docs.map(d => ({id: d.id, ...d.data()})));
        }, (error) => console.warn("Orders sync error:", error));

        return () => { wlUnsub(); ordersUnsub(); };
      } else {
        setWishlist([]);
        setOrders([]);
      }
    });
    return () => unsubscribe();
  }, []);

  // --- ADMIN LISTENER ---
  useEffect(() => {
    if (user && (user.email === 'gaboleandro189@gmail.com' || user.email?.includes('ticketpro.lat') || user.email?.includes('admin'))) {
       const adminOrdersUnsub = onSnapshot(collection(db, 'orders'), (snap) => {
         setOrders(snap.docs.map(d => ({id: d.id, ...d.data()})));
       }, (error) => console.warn("Admin orders sync error:", error));
       
       const adminChatsUnsub = onSnapshot(query(collection(db, 'chats'), where('status', 'in', ['waiting_human', 'active_human', 'closed'])), (snap) => {
         // Sort chats by updatedAt
         const chs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Chat));
         chs.sort((a,b) => new Date((b.updatedAt as any).seconds ? (b.updatedAt as any).seconds*1000 : b.updatedAt).getTime() - new Date((a.updatedAt as any).seconds ? (a.updatedAt as any).seconds*1000 : a.updatedAt).getTime());
         setAdminActiveChats(chs);
       }, (error) => console.warn("Admin chats sync error:", error));

       const adminPromosUnsub = onSnapshot(collection(db, 'promos'), (snap) => {
         setPromos(snap.docs.map(d => ({id: d.id, ...d.data()} as Promo)));
       }, (error) => console.warn("Admin promos sync error:", error));

       return () => { adminOrdersUnsub(); adminChatsUnsub(); adminPromosUnsub(); };
    }
  }, [user]);

  // Load Store Config
  useEffect(() => {
    const configUnsub = onSnapshot(doc(db, 'config', 'global'), (docSnap) => {
      if (docSnap.exists()) {
        setStoreConfig(docSnap.data() as StoreConfig);
      } else {
        setStoreConfig({ taxRate: 0 }); // missing config default
      }
    }, (error) => console.warn("Config sync error:", error));
    return () => configUnsub();
  }, []);

  const sendOtpEmail = async (email: string, code: string) => {
     await fetch('/api/send-email', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          to: email,
          fromType: 'hello',
          emailType: 'otp',
          customData: { code },
          subject: 'Tu código de verificación - L\'Essentiel',
          text: `Tu código es: ${code}`,
        })
     });
  };

  const handleEmailRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput.length < 6) {
       showToast('La contraseña debe tener al menos 6 caracteres');
       return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailInput)) {
       showToast('Ingresa un correo electrónico válido');
       return;
    }
    try {
      const cred = await createUserWithEmailAndPassword(auth, emailInput, passwordInput);
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      await setDoc(doc(db, 'users', cred.user.uid), {
        uid: cred.user.uid,
        email: emailInput,
        displayName: emailInput.split('@')[0],
        addresses: [],
        otpCode: code,
        otpExpires: Date.now() + 5 * 60 * 1000,
        isVerified: false
      });
      await sendOtpEmail(emailInput, code);
      setAuthMode('otp');
      showToast('Código de 6 dígitos enviado a tu correo');
    } catch (err: any) {
      console.error("Auth Register Error:", err);
      if (err.code === 'auth/email-already-in-use') import('sonner').then(({ toast }) => toast.error('Correo ya registrado', { description: 'Intenta iniciar sesión o usa otro correo electrónico' }));
      else if (err.code === 'auth/weak-password') import('sonner').then(({ toast }) => toast.error('Contraseña débil', { description: 'La contraseña debe tener al menos 6 caracteres' }));
      else if (err.code === 'auth/operation-not-allowed') import('sonner').then(({ toast }) => toast.error('Registro no disponible', { description: 'Por favor, contacta con el administrador.' }));
      else import('sonner').then(({ toast }) => toast.error('Error al registrar cuenta', { description: 'Revisa tu conexión o intenta más tarde.' }));
    }
  };

  const sendLoginAlert = (email: string) => {
    fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
         to: email,
         fromType: 'team',
         emailType: 'security',
         customData: {
           message: "Acabas de iniciar sesión en L'Essentiel. Si fuiste tú, puedes ignorar este mensaje.",
           device: navigator.userAgent
         },
         subject: 'Nuevo inicio de sesión en L\'Essentiel',
         text: `Hemos detectado un inicio de sesión en tu cuenta. Si no fuiste tú, por favor cambia tu contraseña inmediatamente.`,
      })
    }).catch(console.error);
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput.length === 0 || emailInput.length === 0) {
      showToast('Por favor completa todos los campos.');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailInput)) {
       showToast('Ingresa un correo electrónico válido');
       return;
    }
    try {
      const cred = await signInWithEmailAndPassword(auth, emailInput, passwordInput);
      const userDoc = await getDoc(doc(db, 'users', cred.user.uid));
      if (userDoc.exists() && userDoc.data().isVerified === false) {
         const code = Math.floor(100000 + Math.random() * 900000).toString();
         await updateDoc(doc(db, 'users', cred.user.uid), {
           otpCode: code,
           otpExpires: Date.now() + 5 * 60 * 1000
         });
         await sendOtpEmail(emailInput, code);
         setAuthMode('otp');
         showToast('Cuenta no verificada. Nuevo código enviado.');
         return;
      }
      setShowLoginModal(false);
      setAuthMode('login');
      setEmailInput('');
      setPasswordInput('');
      sendLoginAlert(cred.user.email || emailInput);
      showToast('Sesión iniciada correctamente');
    } catch(err: any) {
      console.error("Auth Login Error:", err);
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') import('sonner').then(({ toast }) => toast.error('Credenciales incorrectas', { description: 'Revisa tu correo o contraseña e intenta nuevamente.' }));
      else if (err.code === 'auth/operation-not-allowed') import('sonner').then(({ toast }) => toast.error('Inicio de sesión no disponible', { description: 'Por favor, contacta con el administrador.' }));
      else import('sonner').then(({ toast }) => toast.error('Error al iniciar sesión', { description: 'Hubo un problema al validar tus datos. Por favor, intenta más tarde.' }));
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        if (data.otpCode === otpInput && Date.now() < data.otpExpires) {
           await updateDoc(doc(db, 'users', user.uid), {
             isVerified: true,
             otpCode: null,
             otpExpires: null
           });
           setIsVerified(true);
           setShowLoginModal(false);
           setAuthMode('login');
           setOtpInput('');
           if (user.email) sendLoginAlert(user.email);
           showToast('¡Cuenta verificada exitosamente!');
        } else {
           showToast('Código inválido o ha expirado');
        }
      }
    } catch(e) {
      showToast('Error verificando código');
    }
  };

  const loginGoogle = async () => {
    try {
      if (window.location.hostname !== 'localhost' && window.location.hostname !== 'store.maesrp.lat') {
         import('sonner').then(({ toast }) => toast.info('Redirigiendo a entorno seguro para inicio de sesión...'));
         setTimeout(() => window.location.href = 'https://store.maesrp.lat', 1000);
         return;
      }
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);
      setShowLoginModal(false);
      if (cred.user.email) sendLoginAlert(cred.user.email);
      showToast('Sesión iniciada correctamente');
    } catch (e: any) {
      console.error(e);
      let desc = e?.message || 'Intenta nuevamente más tarde.';
      if (e?.code === 'auth/unauthorized-domain') {
         desc = 'Dominio no autorizado. Ve a Firebase Console > Authentication > Settings > Authorized domains y agrega este dominio.';
      } else if (e?.code === 'auth/popup-closed-by-user') {
         desc = 'El popup de inicio de sesión fue cerrado.';
      }
      import('sonner').then(({ toast }) => toast.error('Error al iniciar sesión con Google', { description: desc }));
    }
  };

  const loginTwitter = async () => {
    try {
      if (window.location.hostname !== 'localhost' && window.location.hostname !== 'store.maesrp.lat') {
         import('sonner').then(({ toast }) => toast.info('Redirigiendo a entorno seguro para inicio de sesión...'));
         setTimeout(() => window.location.href = 'https://store.maesrp.lat', 1000);
         return;
      }
      const provider = new TwitterAuthProvider();
      await signInWithPopup(auth, provider);
      setShowLoginModal(false);
      showToast('Sesión iniciada correctamente');
    } catch (e: any) {
      console.error(e);
      let desc = e?.message || 'Recuerda configurar las llaves de X en Firebase Auth';
      if (e?.code === 'auth/unauthorized-domain') {
         desc = 'Dominio no autorizado. Ve a Firebase Console > Authentication > Settings > Authorized domains y agrega este dominio.';
      } else if (e?.code === 'auth/popup-closed-by-user') {
         desc = 'El popup de inicio de sesión fue cerrado.';
      }
      import('sonner').then(({ toast }) => toast.error('Error al iniciar sesión con X (Twitter)', { description: desc }));
    }
  };

  const logout = async () => {
    await signOut(auth);
    setView('home');
    showToast('Sesión cerrada');
  };

  // Show a toast message
  const showToast = (message: string) => {
    import('sonner').then(({ toast }) => {
       toast(message);
    });
  };

  // Actions
  const handleAISearch = async () => {
    if (!searchQuery.trim()) {
        showToast('Por favor escribe algo para buscar');
        return;
    }
    if (searchQuery.trim().length > 100) {
        showToast('Tu solicitud es muy larga (máximo 100 caracteres)');
        return;
    }
    setIsSearchingAI(true);
    setAiSearchResults(null);
    try {
      const catalogContext = products.map(p => `ID: ${p.id}, NAME: ${p.name}, DESC: ${p.description}, CATEGORY: ${p.category}`).join('; ');
      
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: `Eres un asistente de búsqueda para una tienda e-commerce de moda y decoración. 
        Este es nuestro catálogo completo: [${catalogContext}].
        El usuario ha escrito la siguiente búsqueda en lenguaje natural: "${searchQuery}".
        Tu objetivo es devolver SOLO un JSON válido que sea un arreglo de strings, donde cada string sea el ID del producto que encaja de forma relevante con la búsqueda del usuario. 
        No agregues texto explicativo, ni comillas extra, solo el JSON puro. Si no hay nada que encaje bien, devuelve []. Ejemplo: ["1", "3"]`,
        config: {
          temperature: 0
        }
      });
      let jsonStr = response.text || "[]";
      jsonStr = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
      const productIds = JSON.parse(jsonStr) as string[];
      const matchedProducts = products.filter(p => productIds.includes(p.id));
      setAiSearchResults(matchedProducts);
    } catch (e) {
      console.error("AI Search Error:", e);
      showToast('Nuestra IA no pudo procesar tu búsqueda en este momento.');
      setAiSearchResults([]); 
    } finally {
      setIsSearchingAI(false);
    }
  };

  const openProduct = (product: Product) => {
    setActiveProduct(product);
    setView('product');
    window.scrollTo(0, 0);
  };

  const toggleWishlist = async (productId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!user) {
      showToast('Por favor, inicia sesión para guardar en favoritos.');
      setShowLoginModal(true);
      return;
    }
    const isWl = wishlist.includes(productId);
    const newWl = isWl ? wishlist.filter(id => id !== productId) : [...wishlist, productId];
    setWishlist(newWl); // Optimistic UI update
    
    try {
      if (isWl) {
        await updateDoc(doc(db, 'wishlists', user.uid), { productIds: arrayRemove(productId) });
        showToast('Producto eliminado de favoritos.');
      } else {
        await updateDoc(doc(db, 'wishlists', user.uid), { productIds: arrayUnion(productId) });
        showToast('Producto guardado en favoritos. Te notificaremos si se agota y vuelve a estar disponible.');
      }
    } catch (e) {
      // Revert if error
      setWishlist(wishlist);
      showToast('Error al actualizar favoritos.');
    }
  };

  const addToCart = (product: Product, size?: string, color?: string) => {
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id && item.size === size && item.color === color);
      if (existing) {
        return prev.map(item =>
          item.product.id === product.id && item.size === size && item.color === color ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { product, quantity: 1, size, color }];
    });
    showToast(`Se añadió ${product.name} al carrito`);
  };

  const updateQuantity = (id: string, size: string | undefined, color: string | undefined, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.product.id === id && item.size === size && item.color === color) {
        const newQty = Math.max(0, item.quantity + delta);
        return { ...item, quantity: newQty };
      }
      return item;
    }).filter(item => item.quantity > 0));
  };

  const cartTotal = cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  // --- VIEWS ---

  // Filter categories, search and sort
  const processedProducts = useMemo(() => {
    let result = products;
    if (activeCategory !== 'All') {
      result = result.filter(p => p.category === activeCategory);
    }
    if (activeSize !== 'All') {
      result = result.filter(p => p.sizes?.includes(activeSize));
    }
    if (activeColor !== 'All') {
      result = result.filter(p => p.colors?.includes(activeColor));
    }
    if (searchQuery) {
      result = result.filter(p => 
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        p.description.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    if (sortBy === 'price-asc') {
      result = [...result].sort((a,b) => a.price - b.price);
    } else if (sortBy === 'price-desc') {
      result = [...result].sort((a,b) => b.price - a.price);
    }
    return result;
  }, [products, activeCategory, activeSize, activeColor, searchQuery, sortBy]);

  const HomeView = () => {
    const [testimonialText, setTestimonialText] = useState('');
    const [testimonialName, setTestimonialName] = useState('');

    const handleSubmitTestimonial = (e: React.FormEvent) => {
      e.preventDefault();
      if (!testimonialText.trim()) return;
      showToast('¡Gracias por tus comentarios! Hemos recibido tu reseña.');
      setTestimonialText('');
      setTestimonialName('');
    };

    return (
     <>
      {/* Promotional Impact Banner */}
      <div className="w-full bg-[#F5F5F0] border-b border-black/5 relative overflow-hidden flex items-center min-h-[60vh] md:min-h-[75vh]">
          {/* Subtle minimal background element */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] h-[80%] border border-ink/5 rotate-3 pointer-events-none hidden md:block"></div>
          
          <div className="relative z-10 container mx-auto px-8 md:px-16 flex flex-col items-center justify-center text-center">
             <motion.span 
               initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}
               className="font-sans uppercase tracking-[0.2em] text-[0.75rem] text-ink-light mb-6 border border-ink/10 px-4 py-2"
             >
               Nueva Colección Otoño • Invierno
             </motion.span>
             
             <motion.h1 
               initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.1 }}
               className="font-serif font-light text-[3.5rem] md:text-[6rem] leading-[1] text-ink tracking-tight mb-8 max-w-4xl"
             >
               La simplicidad<br/><span className="italic text-ink/70">es máxima</span> sofisticación
             </motion.h1>

             <motion.p 
               initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.3 }}
               className="font-sans text-[0.95rem] text-ink-light max-w-lg mb-12 leading-relaxed"
             >
               Inspirados en el silencio de lo cotidiano. Descubre líneas puras, telas excepcionales y una estética que trasciende las temporadas.
             </motion.p>
             
             <motion.button 
               initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.5 }}
               onClick={() => {
                  document.getElementById('catalog-section')?.scrollIntoView({ behavior: 'smooth' });
               }}
               className="bg-ink text-white py-[1.2rem] px-12 uppercase tracking-[0.1em] text-[0.8rem] font-bold hover:bg-white hover:text-ink border border-ink transition-all duration-300 shadow-xl shadow-ink/10 cursor-pointer"
             >
               Descubre la Colección
             </motion.button>
          </div>
      </div>

      <div id="catalog-section" className="fade-in animate-in fade-in duration-500 lg:flex lg:px-16 lg:py-16 px-8 py-10 gap-16 max-w-[1400px] mx-auto items-start">
        {/* Sidebar Filters */}
      <section className="lg:flex-[0.8] flex flex-col justify-start mb-12 lg:mb-0 lg:sticky lg:top-32">
        <h2 className="font-serif italic text-[1.8rem] mb-6 text-ink">Catálogo</h2>

        {/* Category Filters and Sort */}
        <div className="mt-12 flex flex-col gap-6">
          <div className="flex flex-wrap gap-4 text-[0.75rem] uppercase tracking-[0.1em]">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`pb-1 transition-colors cursor-pointer border-b ${
                  activeCategory === cat ? 'border-ink text-ink font-bold' : 'border-transparent text-ink-light hover:text-ink'
                }`}
              >
                {cat === 'All' ? 'Toda la colección' : cat}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-[0.75rem] uppercase tracking-[0.1em]">
            <div className="flex items-center gap-2">
              <span className="text-ink-light">Ordenar:</span>
              <select 
                className="bg-transparent border-none outline-none text-ink font-bold cursor-pointer"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
              >
                <option value="new">Lo más nuevo</option>
                <option value="price-asc">Precio: Menor a Mayor</option>
                <option value="price-desc">Precio: Mayor a Menor</option>
              </select>
            </div>

            {availableSizes.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-ink-light">Talla:</span>
              <select 
                className="bg-transparent border-none outline-none text-ink font-bold cursor-pointer"
                value={activeSize}
                onChange={(e) => setActiveSize(e.target.value)}
              >
                {availableSizes.map(size => (
                  <option key={size} value={size}>{size === 'All' ? 'Todas' : size}</option>
                ))}
              </select>
            </div>
            )}

            {availableColors.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-ink-light">Color:</span>
              <select 
                className="bg-transparent border-none outline-none text-ink font-bold cursor-pointer"
                value={activeColor}
                onChange={(e) => setActiveColor(e.target.value)}
              >
                {availableColors.map(color => (
                  <option key={color} value={color}>{color === 'All' ? 'Todos' : color}</option>
                ))}
              </select>
            </div>
            )}
          </div>
        </div>
      </section>

      {/* Grid */}
      <section className="lg:flex-[1.8] columns-1 sm:columns-2 gap-6 pb-24 lg:pb-0 space-y-6">
        {processedProducts.length === 0 && (
           <div className="w-full py-12 text-center text-ink-light italic font-serif break-inside-avoid">No se encontraron productos.</div>
        )}
        {processedProducts.map(product => (
           <div key={product.id} className="relative cursor-pointer break-inside-avoid" onClick={() => openProduct(product)}>
            <ProductCard
              title={product.name}
              price={product.price}
              currency="$"
              image={product.image}
              rating={product.reviews ? product.reviews.reduce((a, b) => a + b.rating, 0) / product.reviews.length : 5}
              reviewsCount={product.reviews?.length || 0}
              colors={product.colors || []}
              sizes={product.sizes || []}
              initialColor={product.colors?.[0] || ''}
              initialSize={product.sizes?.[0] || 'Única'}
              isWishlisted={wishlist.includes(product.id)}
              onToggleWishlist={(e) => toggleWishlist(product.id, e)}
              className="max-w-full rounded-none border-black/5 shadow-none hover:shadow-lg transition-shadow bg-cream"
              onAddToCart={(details) => {
                 setTimeout(() => addToCart(product, details.size, details.color), 0); 
              }}
            />
          </div>
        ))}
      </section>
      </div>

      {/* Testimonials Section */}
      <section className="bg-cream py-24 px-8 md:px-16 border-t border-black/5 fade-in animate-in duration-700">
        <div className="max-w-[1400px] mx-auto flex flex-col md:flex-row gap-16">
          <div className="flex-1">
             <h2 className="font-serif italic text-[2.5rem] mb-8 text-ink">Lo que dicen de nosotros</h2>
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
               <div className="bg-white p-8 border border-black/5 flex flex-col justify-between">
                 <p className="text-[0.9rem] italic text-ink-light mb-6">"La simplicidad de sus prendas y la calidad de los materiales son inigualables."</p>
                 <div className="flex items-center gap-2">
                   <div className="w-8 h-8 bg-ink text-white rounded-full flex items-center justify-center font-bold text-[0.8rem]">CM</div>
                   <span className="font-bold text-[0.8rem] uppercase tracking-[0.1em]">Camila M.</span>
                 </div>
               </div>
               <div className="bg-white p-8 border border-black/5 flex flex-col justify-between">
                 <p className="text-[0.9rem] italic text-ink-light mb-6">"Una experiencia estética en todo momento. El empaque y la atención al cliente son un 10."</p>
                 <div className="flex items-center gap-2">
                   <div className="w-8 h-8 bg-ink text-white rounded-full flex items-center justify-center font-bold text-[0.8rem]">JP</div>
                   <span className="font-bold text-[0.8rem] uppercase tracking-[0.1em]">Javier P.</span>
                 </div>
               </div>
               <div className="bg-white p-8 border border-black/5 flex flex-col justify-between hidden sm:flex">
                 <p className="text-[0.9rem] italic text-ink-light mb-6">"Buscaba piezas atemporales que duraran años. Feliz con el abrigo de lana que adquirí esta temporada."</p>
                 <div className="flex items-center gap-2">
                   <div className="w-8 h-8 bg-ink text-white rounded-full flex items-center justify-center font-bold text-[0.8rem]">SV</div>
                   <span className="font-bold text-[0.8rem] uppercase tracking-[0.1em]">Sofía V.</span>
                 </div>
               </div>
               <div className="bg-white p-8 border border-black/5 flex flex-col justify-between hidden sm:flex">
                 <p className="text-[0.9rem] italic text-ink-light mb-6">"Me encanta cómo siempre encuentran la forma de sorprender usando minimalismo puro y grandes texturas."</p>
                 <div className="flex items-center gap-2">
                   <div className="w-8 h-8 bg-ink text-white rounded-full flex items-center justify-center font-bold text-[0.8rem]">LR</div>
                   <span className="font-bold text-[0.8rem] uppercase tracking-[0.1em]">Luis R.</span>
                 </div>
               </div>
             </div>
          </div>
          <div className="md:w-[400px]">
            <h3 className="font-serif italic text-[1.5rem] mb-6 text-ink">Comparte tu reseña</h3>
            <p className="text-[0.9rem] text-ink-light mb-8">Nos encantaría escuchar tu opinión sobre la calidad de las telas y el servicio post-venta.</p>
            <form onSubmit={handleSubmitTestimonial} className="flex flex-col gap-4">
              <input 
                type="text"
                placeholder="Tu nombre (opcional)"
                value={testimonialName}
                onChange={(e) => setTestimonialName(e.target.value)}
                className="border-b border-black/20 pb-2 bg-transparent text-[0.9rem] focus:outline-none focus:border-ink transition-colors"
              />
              <textarea 
                placeholder="Escribe tu reseña aquí..."
                value={testimonialText}
                onChange={(e) => setTestimonialText(e.target.value)}
                required
                rows={4}
                className="border-b border-black/20 pb-2 bg-transparent text-[0.9rem] focus:outline-none focus:border-ink transition-colors resize-none mt-4"
              />
              <button 
                type="submit"
                className="bg-ink text-white px-8 py-3 text-[0.75rem] uppercase tracking-[0.1em] font-bold mt-4 hover:bg-black transition-colors"
                title="Publicar comentario"
              >
                Enviar Reseña
              </button>
            </form>
          </div>
        </div>
      </section>
     </>
    );
  };

  const ProductView = () => {
    const [selectedSize, setSelectedSize] = useState<string | undefined>();
    const [selectedColor, setSelectedColor] = useState<string | undefined>();
    const [reviewText, setReviewText] = useState('');
    const [rating, setRating] = useState(5);
    const [activeImageIndex, setActiveImageIndex] = useState(0);
    const [isZoomed, setIsZoomed] = useState(false);
    const imageContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      setSelectedSize(activeProduct?.sizes?.[0] !== 'Única' ? activeProduct?.sizes?.[0] : undefined);
      setSelectedColor(activeProduct?.colors?.[0]);
      setActiveImageIndex(0);
      setIsZoomed(false);
    }, [activeProduct]);

    if (!activeProduct) return null;
    
    // Create an array of proxy images to simulate a carousel if the product object only has one image property
    const productImages = [
      activeProduct.image,
      activeProduct.image.replace('/800/1000', '/800/1001') + '?carousel=1',
      activeProduct.image.replace('/800/1000', '/800/1002') + '?carousel=2',
      activeProduct.image.replace('/800/1000', '/800/1003') + '?carousel=3'
    ];

    const relatedProducts = products
      .filter(p => p.category === activeProduct.category && p.id !== activeProduct.id)
      .slice(0, 3);
      
    const isOutOfStock = activeProduct.stock === 0;

    const handleAddReview = async (e: React.FormEvent) => {
       e.preventDefault();
       if (!user) {
          setShowLoginModal(true);
          return;
       }
       if (!reviewText.trim()) return;
       
       showToast('Publicando opinión...');
       try {
         const newReview: Review = {
           id: 'REV-'+Date.now(),
           userId: user.uid,
           userName: user.displayName || 'Usuario',
           rating,
           text: reviewText,
           date: new Date().toISOString()
         };
         await updateDoc(doc(db, 'products', activeProduct.id), {
           reviews: arrayUnion(newReview)
         });
         setActiveProduct(prev => prev ? {...prev, reviews: [...(prev.reviews || []), newReview]} : null);
         setReviewText('');
         showToast('¡Gracias por tu opinión!');
       } catch(e) {
         showToast('Error al publicar la opinión.');
       }
    };
    
    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isZoomed || !imageContainerRef.current) return;
      
      const { left, top, width, height } = imageContainerRef.current.getBoundingClientRect();
      const x = ((e.clientX - left) / width) * 100;
      const y = ((e.clientY - top) / height) * 100;
      
      const img = imageContainerRef.current.querySelector('img');
      if (img) {
        img.style.transformOrigin = `${x}% ${y}%`;
      }
    };

    const handleAddToCart = () => {
      const itemToAdd = { ...activeProduct, size: selectedSize || 'Única', color: selectedColor };
      setCart(prev => {
        const existing = prev.find(i => i.product.id === itemToAdd.id && i.size === itemToAdd.size && i.color === itemToAdd.color);
        if (existing) {
          return prev.map(i => i.product.id === itemToAdd.id && i.size === itemToAdd.size && i.color === itemToAdd.color ? { ...i, quantity: i.quantity + 1 } : i);
        }
        return [...prev, { product: itemToAdd, quantity: 1, size: itemToAdd.size, color: itemToAdd.color }];
      });
      showToast(`Se agregó ${activeProduct.name} al carrito.`);
    };

    return (
      <div className="px-8 md:px-16 py-12 max-w-[1400px] mx-auto animate-in fade-in duration-500 pb-32 md:pb-12">
        <button 
          onClick={() => setView('home')} 
          className="flex items-center gap-2 text-[0.75rem] uppercase tracking-[0.1em] font-bold mb-12 hover:text-ink-light transition-colors cursor-pointer"
        >
          <ArrowLeft size={16} />
          Volver a la colección
        </button>

        <div className="flex flex-col md:flex-row gap-12 lg:gap-16 mb-24">
          <div className="flex-1 bg-white p-6 border border-transparent relative flex flex-col gap-4">
            <button 
              onClick={(e) => toggleWishlist(activeProduct.id, e)}
              className="absolute top-8 right-8 z-10 p-2 bg-white/80 backdrop-blur-sm rounded-full hover:bg-white transition-colors border border-black/5"
            >
              <Heart size={20} className={wishlist.includes(activeProduct.id) ? "fill-ink" : ""} />
            </button>
            <div 
              ref={imageContainerRef}
              className="w-full relative aspect-square overflow-hidden bg-cream/50 cursor-zoom-in"
              onClick={() => setIsZoomed(!isZoomed)}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setIsZoomed(false)}
            >
              <AnimatePresence mode="wait">
                <motion.img 
                  key={activeImageIndex}
                  src={productImages[activeImageIndex]} 
                  alt={activeProduct.name} 
                  initial={{ opacity: 0, scale: 1.05 }}
                  animate={{ 
                    opacity: 1, 
                    scale: isZoomed ? 2 : 1 
                  }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className={`w-full h-full object-cover transition-transform duration-200 ${isZoomed ? 'cursor-zoom-out' : 'cursor-zoom-in'}`}
                  referrerPolicy="no-referrer"
                />
              </AnimatePresence>
            </div>
            
            {/* Thumbnail Navigation */}
            <div className="flex gap-4 overflow-x-auto pb-2 snap-x">
               {productImages.map((img, idx) => (
                 <button 
                    key={idx}
                    onClick={() => setActiveImageIndex(idx)}
                    className={`shrink-0 w-20 h-24 overflow-hidden border transition-all cursor-pointer snap-center ${activeImageIndex === idx ? 'border-ink opacity-100' : 'border-transparent opacity-60 hover:opacity-100'}`}
                 >
                    <img 
                      src={img} 
                      alt={`Vista ${idx + 1}`} 
                      className="w-full h-full object-cover" 
                      referrerPolicy="no-referrer"
                    />
                 </button>
               ))}
            </div>
          </div>
          <div className="flex-1 flex flex-col justify-center max-w-md">
            <p className="font-serif italic text-[1.2rem] text-ink-light mb-2">{activeProduct.category}</p>
            <h1 className="font-serif font-light text-[3.5rem] leading-[1] mb-6 text-ink">{activeProduct.name}</h1>
            <p className="font-serif italic text-[1.5rem] mb-6 text-ink">${activeProduct.price.toFixed(2)}</p>
            
            <p className="text-[0.9rem] text-ink-light leading-relaxed mb-8">
              {activeProduct.description}
            </p>
            
            {activeProduct.sizes && activeProduct.sizes.length > 0 && activeProduct.sizes[0] !== 'Única' && (
              <div className="mb-8">
                 <p className="text-[0.75rem] uppercase tracking-[0.1em] mb-3 text-ink-light font-bold">Tamaño</p>
                 <div className="flex gap-3">
                   {activeProduct.sizes.map(size => (
                     <button
                       key={size}
                       onClick={() => setSelectedSize(size)}
                       className={`w-12 h-12 flex items-center justify-center border transition-colors cursor-pointer text-[0.8rem] ${selectedSize === size ? 'border-ink bg-ink text-white' : 'border-black/10 hover:border-ink/50 bg-white'}`}
                     >
                       {size}
                     </button>
                   ))}
                 </div>
              </div>
            )}
            {activeProduct.colors && activeProduct.colors.length > 0 && (
              <div className="mb-8">
                 <p className="text-[0.75rem] uppercase tracking-[0.1em] mb-3 text-ink-light font-bold">Color</p>
                 <div className="flex gap-3">
                   {activeProduct.colors.map(color => (
                     <button
                       key={color}
                       onClick={() => setSelectedColor(color)}
                       className={`px-4 py-2 flex items-center justify-center border transition-colors cursor-pointer text-[0.8rem] ${selectedColor === color ? 'border-ink bg-ink text-white' : 'border-black/10 hover:border-ink/50 bg-white'}`}
                     >
                       {color}
                     </button>
                   ))}
                 </div>
              </div>
            )}

            <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/90 backdrop-blur-md border-t border-black/10 z-50 md:static md:bg-transparent md:border-none md:p-0 md:block flex justify-center">
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.95 }} className="w-full max-w-[400px] md:max-w-none">
                <button 
                  disabled={isOutOfStock || (activeProduct.sizes && activeProduct.sizes[0] !== 'Única' && !selectedSize) || (activeProduct.colors && activeProduct.colors.length > 0 && !selectedColor)}
                  onClick={handleAddToCart}
                  className={`py-[1.2rem] px-8 text-[0.8rem] uppercase tracking-[0.1em] transition-colors w-full cursor-pointer 
                     ${isOutOfStock ? 'bg-black/10 text-black/40 cursor-not-allowed' : 'bg-ink text-white hover:bg-black'}`}
                >
                  {isOutOfStock ? 'Agotado' : 'Añadir al Carrito'}
                </button>
              </motion.div>
            </div>
          </div>
        </div>

        {/* Reviews Section */}
        <div className="mt-16 pt-16 border-t border-black/5 flex flex-col lg:flex-row gap-16">
           <div className="flex-1">
             <h3 className="font-serif italic text-[2rem] text-ink mb-8">Opiniones</h3>
             {(!activeProduct.reviews || activeProduct.reviews.length === 0) ? (
               <p className="text-ink-light text-[0.9rem] italic font-serif">Aún no hay opiniones de este producto. Sé el primero.</p>
             ) : (
               <div className="flex flex-col gap-8">
                 {activeProduct.reviews.map(rev => (
                   <div key={rev.id} className="border-b border-black/5 pb-8">
                     <div className="flex items-center justify-between mb-4">
                       <span className="font-bold text-[0.85rem]">{rev.userName}</span>
                       <div className="flex text-ink">
                         {[...Array(5)].map((_, i) => (
                           <Star key={i} size={14} className={i < rev.rating ? "fill-ink" : "text-black/10"} />
                         ))}
                       </div>
                     </div>
                     <p className="text-[0.9rem] text-ink-light">{rev.text}</p>
                     <p className="text-[0.7rem] text-ink/40 mt-4 uppercase tracking-widest">{new Date(rev.date).toLocaleDateString()}</p>
                   </div>
                 ))}
               </div>
             )}
           </div>
           
           <div className="lg:w-1/3 bg-white p-8 border border-black/5">
             <h4 className="font-bold uppercase tracking-[0.1em] text-[0.8rem] mb-6">Dejar una opinión</h4>
             <form onSubmit={handleAddReview} className="flex flex-col gap-4">
               <div>
                  <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Puntuación</label>
                  <div className="flex cursor-pointer gap-1 mb-2">
                    {[1, 2, 3, 4, 5].map(star => (
                      <Star key={star} onClick={() => setRating(star)} size={20} className={star <= rating ? "fill-ink text-ink" : "text-black/10"} />
                    ))}
                  </div>
               </div>
               <div>
                  <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Tu Reseña</label>
                  <textarea 
                    value={reviewText} onChange={(e) => setReviewText(e.target.value)}
                    className="w-full border border-black/10 p-3 text-[0.85rem] outline-none focus:border-ink resize-none" 
                    rows={4} required placeholder="¿Qué te pareció el producto?"
                  />
               </div>
               <button type="submit" className="w-full bg-ink text-white py-[1rem] text-[0.75rem] uppercase tracking-[0.1em] hover:bg-black transition-colors cursor-pointer">
                 Publicar
               </button>
             </form>
           </div>
        </div>

        {/* Related Products */}
        {relatedProducts.length > 0 && (
           <div className="mt-24 pt-16 border-t border-black/5">
             <h3 className="font-serif italic text-[2rem] text-ink mb-12">Podría interesarte</h3>
             <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
               {relatedProducts.map(product => (
                 <div key={product.id} className="cursor-pointer" onClick={() => openProduct(product)}>
                   <ProductCard
                     title={product.name}
                     price={product.price}
                     currency="$"
                     image={product.image}
                     rating={product.reviews ? product.reviews.reduce((a, b) => a + b.rating, 0) / product.reviews.length : 5}
                     reviewsCount={product.reviews?.length || 0}
                     colors={product.colors || []}
                     sizes={product.sizes || []}
                     initialColor={product.colors?.[0] || ''}
                     initialSize={product.sizes?.[0] || 'Única'}
                     isWishlisted={wishlist.includes(product.id)}
                     onToggleWishlist={(e) => toggleWishlist(product.id, e)}
                     className="max-w-full rounded-none border-black/5 shadow-none hover:shadow-lg transition-shadow bg-cream"
                     onAddToCart={(details) => {
                       setTimeout(() => addToCart(product, details.size, details.color), 0); 
                     }}
                   />
                 </div>
               ))}
             </div>
           </div>
        )}
      </div>
    );
  };

  const CartView = () => (
    <div className="px-8 md:px-16 py-12 max-w-7xl mx-auto animate-in fade-in duration-500 min-h-[70vh]">
      <div className="flex items-center justify-between mb-12 pb-4 border-b border-black/5">
        <h1 className="font-serif italic text-[2rem] text-ink">Tu Carrito</h1>
        <button 
          onClick={() => setView('home')} 
          className="text-[1.2rem] hover:text-ink-light cursor-pointer"
        >
          ✕
        </button>
      </div>

      {cart.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 bg-[#F5F5F0]/40 border border-black/5 rounded-2xl animate-in fade-in zoom-in-95 duration-500">
           <ShoppingCart size={48} className="text-ink/20 mb-6" strokeWidth={1} />
           <h3 className="font-serif text-[1.8rem] text-ink mb-3 text-center">Tu carrito se siente ligero</h3>
           <p className="text-[0.9rem] text-ink-light mb-8 text-center max-w-md px-4 font-sans">
             Aún no has añadido ningún artículo. Sumérgete en nuestra colección y encuentra esa pieza esencial que estabas buscando.
           </p>
           <button 
             onClick={() => setView('home')}
             className="bg-ink text-white py-[1.1rem] px-10 uppercase tracking-[0.1em] text-[0.75rem] font-bold hover:bg-black transition-all hover:scale-105 cursor-pointer shadow-lg outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ink"
             aria-label="Volver a la colección para descubrir productos"
           >
             Explorar la Colección
           </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-16">
          <div className="lg:col-span-7 flex flex-col gap-6">
            {cart.map((item) => (
              <div key={`${item.product.id}-${item.size}-${item.color}`} className="flex gap-6 items-center flex-wrap pb-6 border-b border-black/5 last:border-0">
                <img 
                  src={item.product.image} 
                  alt={item.product.name} 
                  className="w-20 h-24 object-cover bg-white p-1 border border-black/5"
                  referrerPolicy="no-referrer"
                />
                <div className="flex-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-[0.85rem]">
                  <div className="flex flex-col">
                    <span className="font-bold">{item.product.name}</span>
                    <span className="font-serif italic text-ink-light mt-1">${item.product.price.toFixed(2)}</span>
                    <span className="text-[0.65rem] uppercase tracking-[0.1em] text-ink/50 mt-2">
                      {item.size && item.size !== 'Única' && `Talla: ${item.size}`} 
                      {item.color && ` • Color: ${item.color}`}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-6">
                    {/* Controls */}
                    <div className="flex items-center gap-4 bg-white border border-black/5 py-1 px-2">
                       <button onClick={() => updateQuantity(item.product.id, item.size, item.color, -1)} className="p-1 hover:text-ink-light cursor-pointer">
                        <Minus size={14} />
                      </button>
                      <span className="w-4 text-center font-serif text-[0.9rem]">{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.product.id, item.size, item.color, 1)} className="p-1 hover:text-ink-light cursor-pointer">
                        <Plus size={14} />
                      </button>
                    </div>
                    {/* Delete */}
                    <button 
                      onClick={() => updateQuantity(item.product.id, item.size, item.color, -item.quantity)}
                      className="text-ink-light hover:text-red-500 transition-colors cursor-pointer"
                      aria-label="Remove item"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          
          <div className="lg:col-span-5 flex flex-col items-end">
            <div className="w-full relative">

              {/* Coupon Code Section */}
              <div className="mb-6 border-b border-black/5 pb-6">
                 <p className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-3">¿Tienes un código de descuento?</p>
                 <div className="flex gap-2">
                    <input 
                       type="text" 
                       value={couponCode} 
                       onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                       className="flex-1 border border-black/10 px-3 py-2 text-[0.8rem] uppercase outline-none focus:border-ink"
                       placeholder="CÓDIGO"
                    />
                    <button 
                      onClick={() => {
                        const promo = promos.find(p => p.code === couponCode && p.active);
                        if (promo) {
                           setDiscountPercent(promo.discountPercent);
                           showToast(`Descuento aplicado: ${promo.discountPercent}%`);
                        } else {
                           setDiscountPercent(0);
                           showToast('Código inválido o inactivo');
                        }
                      }}
                      className="bg-black/5 px-4 text-[0.75rem] uppercase tracking-widest hover:bg-black/10 transition-colors cursor-pointer"
                    >
                      Aplicar
                    </button>
                 </div>
                 {discountPercent > 0 && <p className="text-[0.75rem] text-ink mt-2">¡{discountPercent}% de descuento aplicado!</p>}
              </div>

              {/* Checkout Interactions */}
              <div className="mb-6 flex flex-col gap-4">
                  {!user && (
                    <div className="flex flex-col gap-2">
                      <p className="text-[0.7rem] uppercase tracking-widest text-ink font-bold mb-1">Tu Correo (Obligatorio para invitados)</p>
                      <input 
                          type="email"
                          value={guestEmail}
                          onChange={(e) => setGuestEmail(e.target.value)}
                          placeholder="correo@ejemplo.com"
                          className="w-full border border-black/10 p-3 text-[0.85rem] outline-none focus:border-ink"
                      />
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                      <p className="text-[0.7rem] uppercase tracking-widest text-ink font-bold mb-1">Tu Dirección para el Envío</p>
                      <textarea 
                          value={addressStr}
                          onChange={(e) => setAddressStr(e.target.value)}
                          required
                          placeholder="Ej. Calle 123, Ciudad, País, Código Postal"
                          className="w-full border border-black/10 p-3 text-[0.85rem] outline-none focus:border-ink resize-none min-h-[80px]"
                      />
                  </div>
              </div>

              {!showPaymentOptions && (
                 <button 
                   onClick={() => {
                     if (!user && !guestEmail.trim()) {
                       showToast('Ingresa un correo para continuar como invitado o inicia sesión');
                       return;
                     }
                     if (!addressStr.trim() || addressStr.trim().length < 10) {
                       showToast("Por favor ingresa una dirección de envío completa (mínimo 10 caracteres).");
                       return;
                     }
                     setShowScheduler(true);
                   }}
                   className="w-full py-[1.2rem] px-8 text-[0.8rem] uppercase tracking-[0.1em] transition-colors cursor-pointer bg-ink text-white hover:bg-black font-bold"
                 >
                   Proceder al Pago
                 </button>
              )}

              {showPaymentOptions && (
                  <div className="w-full flex flex-col gap-4 animate-in fade-in duration-300 border-t border-black/5 pt-6 mt-2">
                     <h4 className="font-serif italic text-ink text-center mb-4 text-[1.2rem]">Selecciona método de pago</h4>
                     
                     <div className="w-full z-0 relative min-h-[48px]">
                        <PayPalScriptProvider options={{ clientId: (import.meta as any).env?.VITE_PAYPAL_CLIENT_ID || "test", currency: "USD", intent: "capture" }}>
                            <PayPalButtons 
                               style={{ layout: "vertical", color: "black", shape: "rect", height: 48 }}
                               createOrder={(data, actions) => {
                                   const baseTotal = cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
                                   const withDiscount = discountPercent > 0 ? baseTotal * (1 - (discountPercent/100)) : baseTotal;
                                   const finalTotal = withDiscount * (1 + (storeConfig.taxRate / 100));
                                   return actions.order.create({
                                       intent: "CAPTURE",
                                       purchase_units: [{ amount: { currency_code: "USD", value: finalTotal.toFixed(2) } }]
                                   });
                               }}
                               onApprove={async (data, actions) => {
                                   if (actions.order) {
                                       const details = await actions.order.capture();
                                       await processSuccessfulOrder('PayPal', details.id || 'PAYPAL-TX');
                                   }
                               }}
                            />
                        </PayPalScriptProvider>
                     </div>

                     <div className="relative flex items-center py-2">
                        <div className="flex-grow border-t border-black/10"></div>
                        <span className="flex-shrink-0 mx-4 text-ink-light text-[0.65rem] uppercase tracking-widest">o usa tarjeta</span>
                        <div className="flex-grow border-t border-black/10"></div>
                     </div>

                     <button 
                       className="w-full bg-white border border-ink text-ink py-[1rem] text-[0.8rem] uppercase tracking-[0.1em] hover:bg-[#f9f9f9] transition-colors cursor-pointer flex justify-center items-center gap-2 font-bold"
                       onClick={handleTilopayCheckout}
                       disabled={isProcessingPayment}
                     >
                       <CreditCard size={16} />
                       {isProcessingPayment ? 'Procesando...' : 'Pagar con Tarjeta'}
                     </button>

                     {/* SIMULATION BUTTON FOR TESTING OVER THE FAKE BACKEND */}
                     <div className="relative flex items-center py-2">
                        <div className="flex-grow border-t border-black/10"></div>
                        <span className="flex-shrink-0 mx-4 text-ink-light text-[0.65rem] uppercase tracking-widest text-orange-500 font-bold">ZONA DE PRUEBAS</span>
                        <div className="flex-grow border-t border-black/10"></div>
                     </div>
                     <button 
                       className="w-full bg-orange-50 border border-orange-500 text-orange-600 py-[1rem] text-[0.8rem] uppercase tracking-[0.1em] hover:bg-orange-100 transition-colors cursor-pointer flex justify-center items-center gap-2 font-bold"
                       onClick={() => processSuccessfulOrder('Pago Simulado', 'TEST-' + Math.random().toString(36).substring(2, 7).toUpperCase())}
                       disabled={isProcessingPayment}
                     >
                       {isProcessingPayment ? 'Simulando...' : 'Simular Pago Exitoso'}
                     </button>

                     <button className="mt-4 text-[0.7rem] uppercase tracking-widest text-ink/70 hover:text-ink text-center w-full cursor-pointer font-bold" onClick={() => setShowPaymentOptions(false)}>Volver atrás</button>
                  </div>
              )}

              {/* Delivery Scheduler Modal / Inject */}
              {showScheduler && !showPaymentOptions && (
                 <div className="fixed top-0 left-0 w-full h-full z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm -mb-[20vh] !my-0">
                    <DeliveryScheduler
                      timeSlots={['09:00 AM', '12:00 PM', '03:00 PM', '06:00 PM']}
                      timeZone="Hora Local"
                      onSchedule={(dateTime) => {
                        // Keep track of scheduled time in order metadata later
                        setShowScheduler(false);
                        setShowPaymentOptions(true); // Automatically triggers the final stage
                      }}
                      onCancel={() => setShowScheduler(false)}
                      className="bg-cream shadow-2xl scale-in"
                    />
                 </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const AboutView = () => (
    <div className="px-8 py-24 max-w-3xl mx-auto animate-in fade-in duration-500 min-h-[70vh]">
      <h1 className="font-serif italic text-[3rem] text-ink mb-8">Nuestra Historia</h1>
      <div className="text-[0.9rem] text-ink-light leading-relaxed flex flex-col gap-6">
        <p>
          L'Essentiel nació de la búsqueda por reducir el ruido. En un mundo cada vez más saturado, creemos que los objetos que nos rodean deben aportar calma, propósito y belleza sutil.
        </p>
        <p>
          Trabajamos directamente con artesanos y pequeños talleres que comparten nuestra filosofía: crear piezas atemporales utilizando materiales honestos y técnicas tradicionales. No seguimos temporadas ni tendencias fugaces; construimos colecciones permanentes diseñadas para durar toda una vida.
        </p>
        <p>
          Cada objeto en nuestra curaduría ha sido seleccionado no solo por su estética, sino por la historia que cuenta y el impacto que genera en su entorno. Bienvenidos a nuestro espacio.
        </p>
      </div>
    </div>
  );

  const ProfileView = () => {
    if (!user) {
      return (
        <div className="px-8 py-24 text-center max-w-lg mx-auto min-h-[70vh]">
          <h1 className="font-serif italic text-[3rem] text-ink mb-6">Acceder</h1>
          <p className="text-[0.9rem] text-ink-light mb-12">Inicia sesión para ver tus pedidos y lista de deseos.</p>
          <button onClick={() => setShowLoginModal(true)} className="bg-ink text-white py-4 px-8 uppercase tracking-[0.1em] text-[0.8rem] hover:bg-black transition-colors w-full cursor-pointer">
            Iniciar Sesión
          </button>
        </div>
      );
    }
    
    const savedProducts = products.filter(p => wishlist.includes(p.id));

    return (
      <div className="px-8 md:px-16 py-12 max-w-[1400px] mx-auto animate-in fade-in duration-500 min-h-[70vh]">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 md:gap-16">
          <div className="md:col-span-1">
             <UserProfileSidebar 
               user={{
                 name: user.displayName || 'Usuario Estético',
                 email: user.email || '',
                 avatarUrl: user.photoURL || 'https://images.unsplash.com/photo-1544723795-3fb6469f5b39?w=900&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8Mjh8fHByb2ZpbGV8ZW58MHx8MHx8fDA%3D'
               }}
               navItems={[
                 { label: 'Mis Pedidos', href: '#pedidos', icon: <ShoppingCart className="h-full w-full" /> },
                 { label: 'Lista de Deseos', href: '#wishlist', icon: <Heart className="h-full w-full" /> },
                 { label: 'Opciones', href: '#', icon: <Settings className="h-full w-full" />, isSeparator: true },
               ]}
               logoutItem={{
                 label: 'Cerrar Sesión',
                 icon: <LogOut className="h-full w-full" />,
                 onClick: logout,
               }}
               className="border-black/5 rounded-none shadow-none bg-cream w-full"
             />
          </div>

          <div className="md:col-span-3 flex flex-col gap-16">
             <section id="pedidos">
              <h2 className="font-serif italic text-[1.5rem] mb-6 text-ink">Mis Pedidos</h2>
              {orders.length === 0 ? (
                <p className="text-[0.85rem] text-ink-light italic">No has realizado ninguna compra aún.</p>
              ) : (
                <div className="flex flex-col gap-4">
                   {orders.map(order => (
                     <div key={order.id} className="border border-black/5 p-4 flex flex-col bg-white text-[0.85rem]">
                        <div className="flex justify-between items-center">
                          <div>
                             <div className="font-medium">Pedido #{order.id.slice(0,8)}</div>
                             <div className="text-ink-light font-serif italic">{new Date(order.createdAt).toLocaleDateString()}</div>
                          </div>
                          <div className="text-right flex flex-col items-end gap-2">
                             <div className="font-serif italic">${order.total.toFixed(2)}</div>
                             <div className="uppercase tracking-widest text-[0.65rem] bg-ink text-white px-2 py-1">{order.status}</div>
                             <button 
                               onClick={async () => {
                                 if (trackingOrderId === order.id) {
                                   setTrackingOrderId(null);
                                   return;
                                 }
                                 setTrackingOrderId(order.id);
                                 setTrackingCoords(null);
                                 setIsTrackingLoading(true);
                                 try {
                                    const response = await ai.models.generateContent({
                                        model: "gemini-3.1-pro-preview",
                                        contents: `Obtén las coordenadas de latitud y longitud aproximadas para la dirección: "${order.address || 'Santiago, Chile'}". Si no se especifica ciudad, asume que es en Chile. Devuelve ÚNICAMENTE un JSON válido con la siguiente estructura exacta: {"lat": -33.4489, "lng": -70.6693}. NO agregues formato markdown, bloques de código, ni texto adicional. Solo el JSON bruto.`,
                                        config: {
                                          temperature: 0,
                                          tools: [{ googleMaps: {} }]
                                        }
                                    });
                                    const text = response.text || '';
                                    const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
                                    const coords = JSON.parse(jsonStr);
                                    if (coords.lat && coords.lng) {
                                      setTrackingCoords(coords);
                                    } else {
                                      throw new Error('Invalid coords');
                                    }
                                 } catch(e) {
                                    console.error("Error geocoding:", e);
                                    showToast('No se pudo establecer conexión con los satélites para el rastreo.');
                                    // Fallback coordinates (Santiago, Chile)
                                    setTrackingCoords({ lat: -33.4489, lng: -70.6693 });
                                 }
                                 setIsTrackingLoading(false);
                               }}
                               className="text-[0.65rem] uppercase tracking-widest text-ink hover:underline border border-transparent cursor-pointer"
                             >
                               {trackingOrderId === order.id ? 'Cerrar Rastreo' : 'Rastrear Mapa'}
                             </button>
                             {(order.status === 'enviado' || order.status === 'entregado') && (
                                <a 
                                  href={`https://parcelsapp.com/es/tracking/${order.transactionId || order.id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[0.65rem] uppercase tracking-widest text-[#0066cc] hover:underline cursor-pointer"
                                  title="Ver proveedor externo de envíos"
                                >
                                  Tracking Externo
                                </a>
                             )}
                          </div>
                        </div>
                            {trackingOrderId === order.id && (
                               <div className="mt-4 pt-4 border-t border-black/5 flex flex-col gap-4">
                                 <h4 className="font-bold flex items-center gap-2"><Search size={14} /> Estado del Paquete</h4>
                                 <OrderTracking
                                    steps={[
                                      { name: "Pedido Realizado", timestamp: new Date(order.createdAt).toLocaleDateString(), isCompleted: true },
                                      { name: "Pago Confirmado", timestamp: new Date(order.createdAt).toLocaleDateString(), isCompleted: order.status === 'pagado' || order.status === 'enviado' || order.status === 'entregado' },
                                      { name: "Enviado", timestamp: order.status === 'enviado' || order.status === 'entregado' ? "Actualizado" : "Pendiente", isCompleted: order.status === 'enviado' || order.status === 'entregado' },
                                      { name: "Entregado", timestamp: order.status === 'entregado' ? "Finalizado" : "Pendiente", isCompleted: order.status === 'entregado' },
                                    ]}
                                    className="mb-4"
                                 />
                                 
                                 <h4 className="font-bold border-t border-black/5 pt-4 flex items-center gap-2 mt-4"><Search size={14} /> Tracking en Vivo</h4>
                                 {isTrackingLoading ? (
                                   <p className="italic text-ink-light">Conectando con satélites y calculando ruta...</p>
                                 ) : trackingCoords ? (
                                   <div className="bg-cream border border-black/5 shadow-inner w-full h-[400px] z-0 relative">
                                     <MapContainer 
                                        center={[-33.4489, -70.6693]} 
                                        zoom={trackingCoords.lat === -33.4489 && trackingCoords.lng === -70.6693 ? 12 : 5} 
                                        scrollWheelZoom={false} 
                                        className="h-full w-full"
                                     >
                                        <TileLayer
                                          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                                        />
                                        <Marker position={[-33.4489, -70.6693]}>
                                          <Popup>Distrito de Lujo, Santiago (Bodega Central)</Popup>
                                        </Marker>
                                        
                                        {(trackingCoords.lat !== -33.4489 || trackingCoords.lng !== -70.6693) && (
                                            <>
                                              <Marker position={[trackingCoords.lat, trackingCoords.lng]}>
                                                 <Popup>Destino de Entrega</Popup>
                                              </Marker>
                                              <Polyline 
                                                positions={[
                                                  [-33.4489, -70.6693],
                                                  [trackingCoords.lat, trackingCoords.lng]
                                                ]} 
                                                pathOptions={{ color: '#1A1A1A', weight: 3, dashArray: '10, 10' }} 
                                              />
                                            </>
                                        )}
                                     </MapContainer>
                                   </div>
                                 ) : null}
                               </div>
                            )}
                     </div>
                   ))}
                </div>
              )}
            </section>

            <section id="wishlist">
              <h2 className="font-serif italic text-[1.5rem] mb-6 text-ink">Lista de Deseos</h2>
              {savedProducts.length === 0 ? (
                <div className="text-center py-12 bg-[#F5F5F0]/40 border border-black/5 rounded-2xl">
                  <Heart size={32} className="text-ink/20 mx-auto mb-4" strokeWidth={1} />
                  <p className="text-[0.9rem] text-ink-light">Tu lista de deseos se encuentra vacía.</p>
                  <button onClick={() => { setActiveCategory('All'); setView('home'); }} className="mt-6 text-ink text-[0.7rem] uppercase tracking-widest font-bold hover:underline cursor-pointer">
                     Ver colección
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {savedProducts.map(product => (
                    <div 
                      key={product.id} 
                      className="bg-white p-4 flex gap-4 items-center border border-transparent hover:border-ink cursor-pointer transition-colors"
                      onClick={() => openProduct(product)}
                    >
                      <div className="w-20 h-20 bg-[#EEEEEE] flex-shrink-0 relative">
                        <button 
                          onClick={(e) => toggleWishlist(product.id, e)}
                          className="absolute -top-2 -right-2 p-1 bg-white border border-black/5 rounded-full hover:text-red-500"
                        >
                          <X size={12} />
                        </button>
                        <img src={product.image} className="w-full h-full object-cover" alt={product.name} />
                      </div>
                      <div className="text-[0.8rem]">
                        <div className="font-medium text-ink">{product.name}</div>
                        <div className="font-serif italic text-ink-light">${product.price.toFixed(2)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    );
  };

  const TermsView = () => (
    <div className="px-8 py-24 max-w-3xl mx-auto animate-in fade-in duration-500 min-h-[70vh]">
      <h1 className="font-serif italic text-[3rem] text-ink mb-8">Términos y Condiciones</h1>
      <div className="text-[0.9rem] text-ink-light leading-relaxed flex flex-col gap-6">
        <p>Última actualización: Noviembre 2026</p>
        <p>Al utilizar nuestra tienda y realizar una compra, aceptas estos términos y condiciones. Todo el contenido de este sitio web es propiedad de L'Essentiel y está protegido por las leyes de propiedad intelectual.</p>
        <p>Los precios anunciados pueden cambiar sin previo aviso. Nos reservamos el derecho de limitar las cantidades de cualquier producto ofrecido y de discontinuar productos en cualquier momento.</p>
        <p>Para mayor información legal y dudas, contáctanos a soporte@lessentiel-boutique.com ó <a href="mailto:support@ticketpro.lat" className="underline hover:text-ink">support@ticketpro.lat</a>.</p>
      </div>
    </div>
  );

  const ShippingView = () => (
    <div className="px-8 py-24 max-w-3xl mx-auto animate-in fade-in duration-500 min-h-[70vh]">
      <h1 className="font-serif italic text-[3rem] text-ink mb-8">Envíos y Devoluciones</h1>
      <div className="text-[0.9rem] text-ink-light leading-relaxed flex flex-col gap-6">
        <h2 className="font-serif italic text-[1.5rem] mt-4 text-ink">Envíos</h2>
        <p>Realizamos envíos a todo el país. Todos nuestros paquetes son empacados utilizando materiales 100% reciclados y libres de plástico.</p>
        <ul className="list-disc pl-5 mt-2 flex flex-col gap-2">
          <li><strong>Envío Estándar (3-5 días hábiles):</strong> $15.00</li>
          <li><strong>Envío Exprés (1-2 días hábiles):</strong> $25.00</li>
          <li><strong>Envío Gratuito:</strong> En órdenes superiores a $200.00</li>
        </ul>
        <h2 className="font-serif italic text-[1.5rem] mt-8 text-ink">Devoluciones</h2>
        <p>Si no estás completamente satisfecho con tu compra, aceptamos devoluciones dentro de los 14 días posteriores a la recepción del pedido. Los productos deben estar en su estado original, sin uso y con sus etiquetas. Los gastos de envío de la devolución corren por cuenta del cliente.</p>
      </div>
    </div>
  );

  const AdminView = () => {
    const [adminTab, setAdminTab] = useState<'products'|'orders'|'chats'|'promos'|'config'>('products');
    const [adminStartDate, setAdminStartDate] = useState<string>('');
    const [adminEndDate, setAdminEndDate] = useState<string>('');
    
    // Admin Products State
    const [isAddingProduct, setIsAddingProduct] = useState(false);
    const [adminProductTab, setAdminProductTab] = useState<'general'|'pricing'|'shipping'|'seo'|'variants'|'associations'|'customization'>('general');
    const [newProduct, setNewProduct] = useState<Partial<Product>>({ 
      name: '', price: 0, compareAtPrice: 0, costPrice: 0, category: '', 
      image: '', images: [], description: '', stock: 0, sizes: [], colors: [], 
      sku: '', barcode: '', status: 'published', slug: '', metaTitle: '', 
      metaDescription: '', brand: '', tags: [], weight: 0, 
      dimensions: { length: 0, width: 0, height: 0 }, 
      isDigital: false, minPurchaseQuantity: 1, maxPurchaseQuantity: 100,
      variants: [], customInputs: [], relatedProductIds: [], tieredPrices: []
    });

    const [sizesInput, setSizesInput] = useState('');
    const [colorsInput, setColorsInput] = useState('');
    const [tagsInput, setTagsInput] = useState('');
    const [imagesInput, setImagesInput] = useState('');

    const handleAddProduct = async (e: React.FormEvent) => {
      e.preventDefault();
      try {
        let productSlug = newProduct.slug?.trim();
        if (!productSlug && newProduct.name) {
           productSlug = newProduct.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
        }

        const productToAdd = { 
          ...newProduct, 
          id: newProduct.id || Date.now().toString(),
          slug: productSlug,
          sizes: sizesInput.split(',').map(s => s.trim()).filter(s => s),
          colors: colorsInput.split(',').map(c => c.trim()).filter(c => c),
          tags: tagsInput.split(',').map(t => t.trim()).filter(t => t),
          images: imagesInput.split(',').map(img => img.trim()).filter(img => img)
        } as Product;
        
        const existingProduct = products.find(p => p.id === productToAdd.id);
        const isRestock = existingProduct && existingProduct.stock === 0 && productToAdd.stock > 0;
        
        await setDoc(doc(db, 'products', productToAdd.id), productToAdd);
        
        if (isRestock) {
          import('firebase/firestore').then(async ({ collection, getDocs, where, query, doc, getDoc }) => {
            try {
              const wlSnap = await getDocs(query(collection(db, 'wishlists'), where('productIds', 'array-contains', productToAdd.id)));
              if (!wlSnap.empty) {
                import('sonner').then(({ toast }) => toast.info(`Notificando restock a ${wlSnap.docs.length} usuario(s)...`));
                for (const wlDoc of wlSnap.docs) {
                  const uDoc = await getDoc(doc(db, 'users', wlDoc.id));
                  if (uDoc.exists() && uDoc.data().email) {
                    await fetch('/api/send-email', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        to: uDoc.data().email,
                        fromType: 'hello',
                        subject: `¡${productToAdd.name} vuelve a estar en stock!`,
                        text: `El artículo que esperabas está de regreso: ${productToAdd.name}. Solo hay ${productToAdd.stock} disponibles. Entra a L'Essentiel para conseguir el tuyo.`,
                      })
                    }).catch(()=>null);
                  }
                }
              }
            } catch (err) {
              console.error("Restock notify error:", err);
            }
          });
        }

        setIsAddingProduct(false);
        setNewProduct({ name: '', price: 0, compareAtPrice: 0, costPrice: 0, category: '', image: '', images: [], description: '', stock: 0, sizes: [], colors: [], sku: '', barcode: '', status: 'published', slug: '', metaTitle: '', metaDescription: '', brand: '', tags: [], weight: 0, dimensions: { length: 0, width: 0, height: 0 }, isDigital: false, minPurchaseQuantity: 1, maxPurchaseQuantity: 100, variants: [], customInputs: [], relatedProductIds: [], tieredPrices: [] });
        setSizesInput('');
        setColorsInput('');
        setTagsInput('');
        setImagesInput('');
        import('sonner').then(({ toast }) => toast.success('Producto guardado exitosamente'));
      } catch (error) {
        import('sonner').then(({ toast }) => toast.error('Error al guardar el producto'));
      }
    };

    const handleEditProduct = (p: Product) => {
       setNewProduct(p);
       setSizesInput(p.sizes?.join(', ') || '');
       setColorsInput(p.colors?.join(', ') || '');
       setTagsInput(p.tags?.join(', ') || '');
       setImagesInput(p.images?.join(', ') || '');
       setAdminProductTab('general');
       setIsAddingProduct(true);
       window.scrollTo(0, 0);
    };

    const handleDeleteProduct = async (id: string) => {
       if(!window.confirm('¿Seguro que deseas eliminar este producto?')) return;
       try {
         await deleteDoc(doc(db, 'products', id));
         import('sonner').then(({ toast }) => toast.success('Producto eliminado'));
       } catch (error) {
         import('sonner').then(({ toast }) => toast.error('Error al eliminar'));
       }
    };

    // Admin Promos State
    const [newPromo, setNewPromo] = useState<Partial<Promo>>({ code: '', discountPercent: 0, active: true, type: 'promo' });
    
    const handleAddPromo = async (e: React.FormEvent) => {
      e.preventDefault();
      try {
        const promoToAdd = { ...newPromo, id: newPromo.code?.toUpperCase() || Date.now().toString(), code: newPromo.code?.toUpperCase() } as Promo;
        await setDoc(doc(db, 'promos', promoToAdd.id), promoToAdd);
        setNewPromo({ code: '', discountPercent: 0, active: true, type: 'promo' });
        showToast('Código promocional guardado');
      } catch (e) {
        showToast('Error al guardar promoción');
      }
    };

    const handleDeletePromo = async (id: string) => {
      try {
         await deleteDoc(doc(db, 'promos', id));
         showToast('Promoción eliminada');
      } catch (e) {
         showToast('Error al eliminar promoción');
      }
    };

    // Admin Config State
    const [configInput, setConfigInput] = useState<StoreConfig>(storeConfig);

    const handleSaveConfig = async (e: React.FormEvent) => {
      e.preventDefault();
      try {
        await setDoc(doc(db, 'config', 'global'), configInput);
        showToast('Configuración global actualizada');
      } catch (e) {
        showToast('Error al actualizar configuración');
      }
    };

    const updateOrderStatus = async (orderId: string, status: string, userEmail: string) => {
       try {
         await updateDoc(doc(db, 'orders', orderId), { status });
         
         if (status === 'enviado') {
             // Send shipping confirmation via email
             await fetch('/api/send-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                   to: userEmail,
                   fromType: 'team',
                   subject: 'Tu pedido ha sido enviado - L\'Essentiel',
                   text: `Tu pedido con ID ${orderId} acaba de ser enviado. Llegará pronto.`,
                   html: `
                      <div style="background-color: #F5F5F0; padding: 60px 20px; font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; line-height: 1.6;">
                        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 60px 40px; border: 1px solid #eeeeee;">
                          <h1 style="font-family: Georgia, serif; font-style: italic; font-weight: normal; font-size: 32px; text-align: center; margin: 0 0 10px 0;">L'Essentiel</h1>
                          <p style="text-align: center; font-size: 12px; text-transform: uppercase; letter-spacing: 3px; color: #8e8e8e; margin: 0 0 40px 0;">Actualización de pedido</p>
                          <p style="font-size: 15px; color: #4a4a4a; margin-bottom: 20px;">¡Buenas noticias! Tu pedido <strong>${orderId}</strong> ha sido empaquetado y enviado.</p>
                          <p style="font-size: 15px; color: #4a4a4a; margin-bottom: 40px;">Puedes rastrearlo desde tu panel de usuario. ¡Gracias por elegir el minimalismo!</p>
                        </div>
                      </div>
                   `
                })
             });
             showToast('Estado actualizado y correo enviado');
         } else {
             showToast('Estado actualizado');
         }
       } catch (e) {
         showToast('Error al actualizar');
       }
    };

    // Very basic stats
    const filteredOrders = orders.filter(o => {
      let isWithinDate = true;
      const orderDate = new Date(o.createdAt);
      if (adminStartDate) {
        const start = new Date(adminStartDate);
        if (orderDate < start) isWithinDate = false;
      }
      if (adminEndDate) {
        const end = new Date(adminEndDate);
        end.setHours(23, 59, 59, 999);
        if (orderDate > end) isWithinDate = false;
      }
      return isWithinDate;
    });

    const totalSales = filteredOrders.filter(o => o.status !== 'procesando').reduce((sum, o) => sum + o.total, 0);
    const paidOrdersLength = filteredOrders.filter(o => o.status === 'pagado').length;

    return (
      <div className="px-8 md:px-16 py-12 max-w-[1400px] mx-auto animate-in fade-in duration-500">
        <div className="flex justify-between items-end mb-12">
           <h1 className="font-serif italic text-[3rem] text-ink">Panel de Control</h1>
           <div className="flex gap-4 mb-4">
              <button 
                onClick={() => setAdminTab('products')} 
                className={`uppercase text-[0.7rem] tracking-widest pb-1 border-b transition-colors ${adminTab === 'products' ? 'border-ink text-ink font-bold' : 'border-transparent text-ink-light'}`}
              >
                 Inventario
              </button>
              <button 
                onClick={() => setAdminTab('orders')} 
                className={`uppercase text-[0.7rem] tracking-widest pb-1 border-b transition-colors flex gap-2 items-center ${adminTab === 'orders' ? 'border-ink text-ink font-bold' : 'border-transparent text-ink-light'}`}
              >
                 Ventas {paidOrdersLength > 0 && <span className="bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[0.5rem]">{paidOrdersLength}</span>}
              </button>
              <button 
                onClick={() => setAdminTab('chats')} 
                className={`uppercase text-[0.7rem] tracking-widest pb-1 border-b transition-colors flex gap-2 items-center ${adminTab === 'chats' ? 'border-ink text-ink font-bold' : 'border-transparent text-ink-light'}`}
              >
                 Atención
                 {adminActiveChats.filter(c => c.status === 'waiting_human').length > 0 && (
                   <span className="bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[0.5rem]">
                     {adminActiveChats.filter(c => c.status === 'waiting_human').length}
                   </span>
                 )}
              </button>
              <button 
                onClick={() => setAdminTab('promos')} 
                className={`uppercase text-[0.7rem] tracking-widest pb-1 border-b transition-colors flex gap-2 items-center ${adminTab === 'promos' ? 'border-ink text-ink font-bold' : 'border-transparent text-ink-light'}`}
              >
                 Promos
              </button>
              <button 
                onClick={() => setAdminTab('config')} 
                className={`uppercase text-[0.7rem] tracking-widest pb-1 border-b transition-colors flex gap-2 items-center ${adminTab === 'config' ? 'border-ink text-ink font-bold' : 'border-transparent text-ink-light'}`}
              >
                 Config
              </button>
              <button 
                onClick={() => setAdminTab('campaigns')} 
                className={`uppercase text-[0.7rem] tracking-widest pb-1 border-b transition-colors flex gap-2 items-center ${adminTab === 'campaigns' ? 'border-ink text-ink font-bold' : 'border-transparent text-ink-light'}`}
              >
                 Campañas
              </button>
           </div>
        </div>

        {adminTab === 'products' ? (
           <div className="flex flex-col gap-12">
             <div className="flex justify-between items-center">
               <h2 className="font-bold text-[1.2rem]">Gestión de Productos</h2>
               <button 
                 onClick={() => setIsAddingProduct(!isAddingProduct)}
                 className="bg-ink text-white px-6 py-2 text-[0.8rem] uppercase tracking-widest hover:bg-black transition"
               >
                 {isAddingProduct ? 'Cancelar' : 'Agregar Nuevo'}
               </button>
             </div>

             {isAddingProduct && (
               <div className="bg-white border border-black/5 animate-in fade-in duration-300">
                 <div className="flex border-b border-black/5 bg-gray-50/50 flex-wrap">
                   <button onClick={(e) => { e.preventDefault(); setAdminProductTab('general'); }} className={`px-6 py-4 text-[0.75rem] uppercase tracking-widest transition-colors ${adminProductTab === 'general' ? 'border-b-2 border-ink text-ink font-bold bg-white' : 'text-ink-light hover:bg-gray-100'}`}>General</button>
                   <button onClick={(e) => { e.preventDefault(); setAdminProductTab('pricing'); }} className={`px-6 py-4 text-[0.75rem] uppercase tracking-widest transition-colors ${adminProductTab === 'pricing' ? 'border-b-2 border-ink text-ink font-bold bg-white' : 'text-ink-light hover:bg-gray-100'}`}>Precio & Inventario</button>
                   <button onClick={(e) => { e.preventDefault(); setAdminProductTab('shipping'); }} className={`px-6 py-4 text-[0.75rem] uppercase tracking-widest transition-colors ${adminProductTab === 'shipping' ? 'border-b-2 border-ink text-ink font-bold bg-white' : 'text-ink-light hover:bg-gray-100'}`}>Envío</button>
                   <button onClick={(e) => { e.preventDefault(); setAdminProductTab('seo'); }} className={`px-6 py-4 text-[0.75rem] uppercase tracking-widest transition-colors ${adminProductTab === 'seo' ? 'border-b-2 border-ink text-ink font-bold bg-white' : 'text-ink-light hover:bg-gray-100'}`}>SEO</button>
                   <button onClick={(e) => { e.preventDefault(); setAdminProductTab('variants'); }} className={`px-6 py-4 text-[0.75rem] uppercase tracking-widest transition-colors ${adminProductTab === 'variants' ? 'border-b-2 border-ink text-ink font-bold bg-white' : 'text-ink-light hover:bg-gray-100'}`}>Variantes</button>
                   <button onClick={(e) => { e.preventDefault(); setAdminProductTab('associations'); }} className={`px-6 py-4 text-[0.75rem] uppercase tracking-widest transition-colors ${adminProductTab === 'associations' ? 'border-b-2 border-ink text-ink font-bold bg-white' : 'text-ink-light hover:bg-gray-100'}`}>Asociaciones</button>
                   <button onClick={(e) => { e.preventDefault(); setAdminProductTab('customization'); }} className={`px-6 py-4 text-[0.75rem] uppercase tracking-widest transition-colors ${adminProductTab === 'customization' ? 'border-b-2 border-ink text-ink font-bold bg-white' : 'text-ink-light hover:bg-gray-100'}`}>Personalización</button>
                 </div>
                 <form onSubmit={handleAddProduct} className="p-8">
                   <div style={{ display: adminProductTab === 'general' ? 'grid' : 'none' }} className="grid-cols-1 md:grid-cols-2 gap-8">
                     <div>
                       <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Nombre del Producto *</label>
                       <input required type="text" value={newProduct.name || ''} onChange={e => setNewProduct({...newProduct, name: e.target.value})} className="w-full border border-black/10 p-3 text-[0.85rem] outline-none mb-6 focus:border-ink transition-colors" />
                     </div>
                     <div>
                       <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Marca</label>
                       <input type="text" value={newProduct.brand || ''} onChange={e => setNewProduct({...newProduct, brand: e.target.value})} className="w-full border border-black/10 p-3 text-[0.85rem] outline-none mb-6 focus:border-ink transition-colors" />
                     </div>
                     <div>
                       <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Categoría *</label>
                       <input required type="text" value={newProduct.category || ''} onChange={e => setNewProduct({...newProduct, category: e.target.value})} className="w-full border border-black/10 p-3 text-[0.85rem] outline-none mb-6 focus:border-ink transition-colors" />
                     </div>
                     <div>
                       <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Etiquetas (separadas por coma)</label>
                       <input type="text" value={tagsInput} onChange={e => setTagsInput(e.target.value)} placeholder="Ej: nuevo, destacado, verano" className="w-full border border-black/10 p-3 text-[0.85rem] outline-none mb-6 focus:border-ink transition-colors" />
                     </div>
                     <div className="md:col-span-2">
                       <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">URL de Imagen Principal *</label>
                       <input required type="url" value={newProduct.image || ''} onChange={e => setNewProduct({...newProduct, image: e.target.value})} className="w-full border border-black/10 p-3 text-[0.85rem] outline-none mb-6 focus:border-ink transition-colors" />
                     </div>
                     <div className="md:col-span-2">
                       <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Imágenes Adicionales (URLs separadas por coma)</label>
                       <textarea value={imagesInput} onChange={e => setImagesInput(e.target.value)} className="w-full border border-black/10 p-3 text-[0.85rem] outline-none mb-6 min-h-[60px] focus:border-ink transition-colors" />
                     </div>
                     <div className="md:col-span-2">
                       <div className="flex justify-between items-center mb-2">
                         <label className="text-[0.7rem] uppercase tracking-widest text-ink-light block">Descripción *</label>
                         <button type="button" onClick={async () => {
                              if (!newProduct.name || !newProduct.category) { import('sonner').then(({ toast }) => toast.error("Ingresa nombre y categoría primero")); return; }
                              import('sonner').then(({ toast }) => toast.info("Generando con IA..."));
                              try {
                                const response = await ai.models.generateContent({
                                    model: "gemini-3-flash-preview",
                                    contents: `Genera una descripción de producto de alta conversión, minimalista y elegante para un producto llamado "${newProduct.name}" de la categoría "${newProduct.category}". Debe destacar exclusividad y lujo sutil. Solo devuelve la descripción en texto plano, sin formato markdown extra, máximo 3 párrafos cortos.`,
                                    config: { systemInstruction: "Eres un experto en e-commerce y marketing para L'Essentiel, una boutique minimalista de alta gama." }
                                });
                                setNewProduct(prev => ({...prev, description: response.text || ''}));
                                import('sonner').then(({ toast }) => toast.success("Descripción generada ✨"));
                              } catch(e) { import('sonner').then(({ toast }) => toast.error("Error generando descripción")); }
                           }} 
                           className="text-[0.65rem] uppercase tracking-widest text-ink flex items-center gap-1 hover:underline outline-none cursor-pointer"
                         ><Sparkles size={12}/> Redactar con IA</button>
                       </div>
                       <textarea required value={newProduct.description || ''} onChange={e => setNewProduct({...newProduct, description: e.target.value})} className="w-full border border-black/10 p-3 text-[0.85rem] outline-none min-h-[150px] focus:border-ink transition-colors" />
                     </div>
                   </div>

                   <div style={{ display: adminProductTab === 'pricing' ? 'grid' : 'none' }} className="grid-cols-1 md:grid-cols-3 gap-8">
                     <div>
                       <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Precio de Venta *</label>
                       <input required type="number" step="0.01" value={newProduct.price === undefined ? '' : newProduct.price} onChange={e => setNewProduct({...newProduct, price: Number(e.target.value)})} className="w-full border border-black/10 p-3 text-[0.85rem] outline-none mb-6 focus:border-ink transition-colors" />
                     </div>
                     <div>
                       <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Precio de Lista (Antes)</label>
                       <input type="number" step="0.01" value={newProduct.compareAtPrice === undefined ? '' : newProduct.compareAtPrice} onChange={e => setNewProduct({...newProduct, compareAtPrice: Number(e.target.value)})} className="w-full border border-black/10 p-3 text-[0.85rem] outline-none mb-6 focus:border-ink transition-colors" />
                     </div>
                     <div>
                       <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Costo Neto</label>
                       <input type="number" step="0.01" value={newProduct.costPrice === undefined ? '' : newProduct.costPrice} onChange={e => setNewProduct({...newProduct, costPrice: Number(e.target.value)})} className="w-full border border-black/10 p-3 text-[0.85rem] outline-none mb-6 focus:border-ink transition-colors" />
                     </div>
                     <div className="col-span-full border-t border-black/5 mb-6 pt-6">
                       <h3 className="font-serif italic text-ink text-[1.2rem] mb-4">Inventario</h3>
                     </div>
                     <div>
                       <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">SKU</label>
                       <input type="text" value={newProduct.sku || ''} onChange={e => setNewProduct({...newProduct, sku: e.target.value})} className="w-full border border-black/10 p-3 text-[0.85rem] outline-none mb-6 focus:border-ink transition-colors" />
                     </div>
                     <div>
                       <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Código de Barras (EAN/UPC)</label>
                       <input type="text" value={newProduct.barcode || ''} onChange={e => setNewProduct({...newProduct, barcode: e.target.value})} className="w-full border border-black/10 p-3 text-[0.85rem] outline-none mb-6 focus:border-ink transition-colors" />
                     </div>
                     <div>
                       <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Stock Disponible *</label>
                       <input required type="number" value={newProduct.stock === undefined ? '' : newProduct.stock} onChange={e => setNewProduct({...newProduct, stock: Number(e.target.value)})} className="w-full border border-black/10 p-3 text-[0.85rem] outline-none mb-6 focus:border-ink transition-colors" />
                     </div>
                     <div className="col-span-full md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-8">
                       <div>
                         <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Variantes: Tallas (separadas por coma)</label>
                         <input type="text" value={sizesInput} onChange={e => setSizesInput(e.target.value)} placeholder="Ej: S, M, L" className="w-full border border-black/10 p-3 text-[0.85rem] outline-none focus:border-ink transition-colors" />
                       </div>
                       <div>
                         <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Variantes: Colores (separados por coma)</label>
                         <input type="text" value={colorsInput} onChange={e => setColorsInput(e.target.value)} placeholder="Ej: Negro, Blanco" className="w-full border border-black/10 p-3 text-[0.85rem] outline-none focus:border-ink transition-colors" />
                       </div>
                     </div>
                     <div className="col-span-full border-t border-black/5 mt-4 pt-6">
                       <h3 className="font-serif italic text-ink text-[1.2rem] mb-4">Precios por Volumen / Reglas al por mayor</h3>
                       <div className="bg-gray-50 p-4 border border-black/5 flex flex-col gap-4">
                         {(newProduct.tieredPrices || []).map((tp, i) => (
                           <div key={i} className="flex gap-4 items-center bg-white p-3 border border-black/5">
                             <div className="flex flex-col">
                               <label className="text-[0.65rem] uppercase text-ink-light mb-1">Cantidad mínima</label>
                               <input type="number" placeholder="Ej: 5" value={tp.quantity || ''} onChange={e => {
                                 const ntp = [...(newProduct.tieredPrices || [])]; ntp[i].quantity = Number(e.target.value); setNewProduct({...newProduct, tieredPrices: ntp});
                               }} className="border border-black/10 p-2 text-[0.8rem] outline-none" />
                             </div>
                             <div className="flex flex-col">
                               <label className="text-[0.65rem] uppercase text-ink-light mb-1">Precio unitario</label>
                               <input type="number" step="0.01" placeholder="Ej: 19.99" value={tp.price || ''} onChange={e => {
                                 const ntp = [...(newProduct.tieredPrices || [])]; ntp[i].price = Number(e.target.value); setNewProduct({...newProduct, tieredPrices: ntp});
                               }} className="border border-black/10 p-2 text-[0.8rem] outline-none" />
                             </div>
                             <button type="button" onClick={() => {
                               const ntp = (newProduct.tieredPrices || []).filter((_, index) => index !== i); setNewProduct({...newProduct, tieredPrices: ntp});
                             }} className="text-red-500 text-[0.75rem] uppercase tracking-widest hover:underline mt-4">Eliminar</button>
                           </div>
                         ))}
                         <button type="button" onClick={() => {
                           const ntp = [...(newProduct.tieredPrices || []), { quantity: 5, price: (newProduct.price || 0) * 0.9 }];
                           setNewProduct({...newProduct, tieredPrices: ntp});
                         }} className="self-start text-[0.75rem] uppercase tracking-widest text-ink hover:underline">+ Agregar Rango de Precio</button>
                       </div>
                     </div>
                   </div>

                   <div style={{ display: adminProductTab === 'shipping' ? 'flex' : 'none' }} className="flex flex-col gap-8">
                     <label className="flex items-center gap-3 cursor-pointer">
                       <input type="checkbox" checked={newProduct.isDigital || false} onChange={e => setNewProduct({...newProduct, isDigital: e.target.checked})} className="w-4 h-4" />
                       <span className="text-[0.85rem] text-ink">Este es un producto digital (no requiere envío)</span>
                     </label>
                     {!newProduct.isDigital && (
                       <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                         <div>
                           <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Peso (kg)</label>
                           <input type="number" step="0.01" value={newProduct.weight || ''} onChange={e => setNewProduct({...newProduct, weight: Number(e.target.value)})} className="w-full border border-black/10 p-3 text-[0.85rem] outline-none focus:border-ink transition-colors" />
                         </div>
                         <div>
                           <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Largo (cm)</label>
                           <input type="number" step="0.1" value={newProduct.dimensions?.length || ''} onChange={e => setNewProduct({...newProduct, dimensions: {...(newProduct.dimensions||{width:0,height:0,length:0}), length: Number(e.target.value)}})} className="w-full border border-black/10 p-3 text-[0.85rem] outline-none focus:border-ink transition-colors" />
                         </div>
                         <div>
                           <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Ancho (cm)</label>
                           <input type="number" step="0.1" value={newProduct.dimensions?.width || ''} onChange={e => setNewProduct({...newProduct, dimensions: {...(newProduct.dimensions||{width:0,height:0,length:0}), width: Number(e.target.value)}})} className="w-full border border-black/10 p-3 text-[0.85rem] outline-none focus:border-ink transition-colors" />
                         </div>
                         <div>
                           <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Alto (cm)</label>
                           <input type="number" step="0.1" value={newProduct.dimensions?.height || ''} onChange={e => setNewProduct({...newProduct, dimensions: {...(newProduct.dimensions||{width:0,height:0,length:0}), height: Number(e.target.value)}})} className="w-full border border-black/10 p-3 text-[0.85rem] outline-none focus:border-ink transition-colors" />
                         </div>
                       </div>
                     )}
                   </div>

                   <div style={{ display: adminProductTab === 'seo' ? 'flex' : 'none' }} className="flex flex-col gap-8">
                     <div>
                       <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Visibilidad</label>
                       <select value={newProduct.status || 'published'} onChange={e => setNewProduct({...newProduct, status: e.target.value as any})} className="w-full md:w-1/3 border border-black/10 p-3 text-[0.85rem] outline-none focus:border-ink transition-colors bg-white">
                         <option value="published">Publicado</option>
                         <option value="draft">Borrador</option>
                         <option value="hidden">Oculto</option>
                       </select>
                     </div>
                     <div>
                       <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">URL amigable (Slug)</label>
                       <input type="text" value={newProduct.slug || ''} onChange={e => setNewProduct({...newProduct, slug: e.target.value})} placeholder="ej: pantalon-lino-beige" className="w-full border border-black/10 p-3 text-[0.85rem] outline-none focus:border-ink transition-colors" />
                     </div>
                     <div>
                       <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Meta Título (SEO)</label>
                       <input type="text" value={newProduct.metaTitle || ''} onChange={e => setNewProduct({...newProduct, metaTitle: e.target.value})} className="w-full border border-black/10 p-3 text-[0.85rem] outline-none focus:border-ink transition-colors" />
                     </div>
                     <div>
                       <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Meta Descripción (SEO)</label>
                       <textarea value={newProduct.metaDescription || ''} onChange={e => setNewProduct({...newProduct, metaDescription: e.target.value})} className="w-full border border-black/10 p-3 text-[0.85rem] outline-none min-h-[100px] focus:border-ink transition-colors" />
                     </div>
                     {newProduct.metaTitle && (
                       <div className="mt-4 p-4 border border-blue-200 bg-blue-50/30 rounded-md">
                         <p className="text-[0.75rem] text-blue-800 uppercase tracking-widest mb-1">Previsualización en Google</p>
                         <p className="text-[#1a0dab] text-[1.1rem] hover:underline cursor-pointer font-medium truncate">{newProduct.metaTitle}</p>
                         <p className="text-[#006621] text-[0.8rem] mb-1">https://store.maesrp.lat/product/{newProduct.slug || newProduct.id}</p>
                         <p className="text-[#545454] text-[0.85rem] truncate">{newProduct.metaDescription || newProduct.description?.substring(0, 150)}</p>
                       </div>
                     )}
                   </div>

                   <div style={{ display: adminProductTab === 'variants' ? 'flex' : 'none' }} className="flex flex-col gap-8">
                     <div>
                       <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Variantes Avanzadas</label>
                       <p className="text-[0.8rem] text-ink-light mb-4">Crea combinaciones de atributos (ej. Talla L + Color Rojo) con precio y SKU independientes.</p>
                       <div className="bg-gray-50 p-4 border border-black/5 flex flex-col gap-4">
                         {(newProduct.variants || []).map((v, i) => (
                           <div key={v.id} className="grid grid-cols-5 gap-4 items-center bg-white p-3 border border-black/5">
                             <input type="text" value={v.name} onChange={e => {
                               const nv = [...(newProduct.variants || [])]; nv[i].name = e.target.value; setNewProduct({...newProduct, variants: nv});
                             }} placeholder="Nombre variante" className="border border-black/10 p-2 text-[0.8rem] outline-none" />
                             <input type="text" value={v.sku} onChange={e => {
                               const nv = [...(newProduct.variants || [])]; nv[i].sku = e.target.value; setNewProduct({...newProduct, variants: nv});
                             }} placeholder="SKU" className="border border-black/10 p-2 text-[0.8rem] outline-none" />
                             <input type="number" value={v.price} onChange={e => {
                               const nv = [...(newProduct.variants || [])]; nv[i].price = Number(e.target.value); setNewProduct({...newProduct, variants: nv});
                             }} placeholder="Precio extra" className="border border-black/10 p-2 text-[0.8rem] outline-none" />
                             <input type="number" value={v.stock} onChange={e => {
                               const nv = [...(newProduct.variants || [])]; nv[i].stock = Number(e.target.value); setNewProduct({...newProduct, variants: nv});
                             }} placeholder="Stock" className="border border-black/10 p-2 text-[0.8rem] outline-none" />
                             <button type="button" onClick={() => {
                               const nv = (newProduct.variants || []).filter((_, index) => index !== i); setNewProduct({...newProduct, variants: nv});
                             }} className="text-red-500 text-[0.75rem] uppercase tracking-widest hover:underline">Eliminar</button>
                           </div>
                         ))}
                         <button type="button" onClick={() => {
                           const nv = [...(newProduct.variants || []), { id: Date.now().toString(), name: '', sku: '', price: 0, stock: 10 }];
                           setNewProduct({...newProduct, variants: nv});
                         }} className="self-start text-[0.75rem] uppercase tracking-widest text-ink hover:underline">+ Agregar Variante</button>
                       </div>
                     </div>
                   </div>

                   <div style={{ display: adminProductTab === 'associations' ? 'flex' : 'none' }} className="flex flex-col gap-8">
                     <div>
                       <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Productos Relacionados (Cross-selling / Up-selling)</label>
                       <p className="text-[0.8rem] text-ink-light mb-4">Selecciona los IDs de los productos que deseas mostrar como sugerencias.</p>
                       <input type="text" value={(newProduct.relatedProductIds || []).join(', ')} onChange={e => {
                         const ids = e.target.value.split(',').map(id => id.trim()).filter(id => id);
                         setNewProduct({...newProduct, relatedProductIds: ids});
                       }} placeholder="Ej: prod-1, prod-2" className="w-full border border-black/10 p-3 text-[0.85rem] outline-none focus:border-ink transition-colors" />
                     </div>
                   </div>

                   <div style={{ display: adminProductTab === 'customization' ? 'flex' : 'none' }} className="flex flex-col gap-8">
                     <div>
                       <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Campos Personalizables (Impresión / Grabado / Textos libres)</label>
                       <p className="text-[0.8rem] text-ink-light mb-4">Permite que tu cliente envíe un texto, un archivo, o seleccione opciones al comprar el producto.</p>
                       <div className="bg-gray-50 p-4 border border-black/5 flex flex-col gap-4">
                         {(newProduct.customInputs || []).map((ci, i) => (
                           <div key={ci.id} className="grid grid-cols-4 gap-4 items-center bg-white p-3 border border-black/5">
                             <input type="text" value={ci.label} onChange={e => {
                               const nc = [...(newProduct.customInputs || [])]; nc[i].label = e.target.value; setNewProduct({...newProduct, customInputs: nc});
                             }} placeholder="Etiqueta (Ej: Nombre a grabar)" className="border border-black/10 p-2 text-[0.8rem] outline-none" />
                             <select value={ci.type} onChange={e => {
                               const nc = [...(newProduct.customInputs || [])]; nc[i].type = e.target.value as any; setNewProduct({...newProduct, customInputs: nc});
                             }} className="border border-black/10 p-2 text-[0.8rem] outline-none bg-white">
                               <option value="text">Texto Corto</option>
                               <option value="file">Subir Archivo</option>
                               <option value="select">Opciones (Dropdown)</option>
                             </select>
                             <label className="flex items-center gap-2">
                               <input type="checkbox" checked={ci.required} onChange={e => {
                                 const nc = [...(newProduct.customInputs || [])]; nc[i].required = e.target.checked; setNewProduct({...newProduct, customInputs: nc});
                               }} />
                               <span className="text-[0.7rem] uppercase tracking-widest">¿Requerido?</span>
                             </label>
                             <button type="button" onClick={() => {
                               const nc = (newProduct.customInputs || []).filter((_, index) => index !== i); setNewProduct({...newProduct, customInputs: nc});
                             }} className="text-red-500 text-[0.75rem] uppercase tracking-widest hover:underline text-right">Eliminar</button>
                             {ci.type === 'select' && (
                                <input type="text" value={ci.options || ''} onChange={e => {
                                  const nc = [...(newProduct.customInputs || [])]; nc[i].options = e.target.value; setNewProduct({...newProduct, customInputs: nc});
                                }} placeholder="Opciones separadas por coma" className="col-span-4 border border-black/10 p-2 text-[0.8rem] outline-none" />
                             )}
                           </div>
                         ))}
                         <button type="button" onClick={() => {
                           const nc = [...(newProduct.customInputs || []), { id: Date.now().toString(), label: '', type: 'text', required: true }];
                           setNewProduct({...newProduct, customInputs: nc} as Partial<Product>);
                         }} className="self-start text-[0.75rem] uppercase tracking-widest text-ink hover:underline">+ Agregar Campo</button>
                       </div>
                     </div>
                   </div>

                   <div className="mt-8 pt-8 border-t border-black/5 flex justify-end gap-4">
                     <button type="button" onClick={() => setIsAddingProduct(false)} className="px-6 py-3 border border-black/10 text-ink text-[0.8rem] uppercase tracking-widest hover:bg-gray-50 transition">
                       Cancelar
                     </button>
                     <button type="submit" className="bg-ink text-white px-10 py-3 text-[0.8rem] uppercase tracking-widest hover:bg-black transition">
                       {newProduct.id ? 'Guardar Cambios' : 'Crear Producto'}
                     </button>
                   </div>
                 </form>
               </div>
             )}

             <div className="bg-white border border-black/5 p-6 overflow-x-auto">
               <table className="w-full text-left">
                 <thead>
                   <tr className="border-b border-black/5 text-[0.7rem] uppercase tracking-widest text-ink-light">
                     <th className="pb-4 font-normal">Producto</th>
                     <th className="pb-4 font-normal">Precio</th>
                     <th className="pb-4 font-normal">Stock</th>
                     <th className="pb-4 font-normal text-right">Acciones</th>
                   </tr>
                 </thead>
                 <tbody>
                   {products.map(p => (
                     <tr key={p.id} className="border-b border-black/5 last:border-0 text-[0.85rem]">
                       <td className="py-4 flex flex-col justify-center">
                          <div className="flex items-center gap-4">
                            <img src={p.image} className="w-10 h-10 object-cover" />
                            <span>{p.name} {p.stock === 0 && <span className="ml-2 text-red-500 text-[0.6rem] uppercase tracking-widest border border-red-500 px-1 rounded">Agotado</span>}</span>
                          </div>
                          {p.reviews && p.reviews.length > 0 && (
                            <button onClick={async () => {
                               showToast("Analizando reseñas con IA...");
                               try {
                                 const response = await ai.models.generateContent({
                                     model: "gemini-3-flash-preview",
                                     contents: `Analiza las siguientes reseñas de clientes sobre un producto. Extrae las ventajas, desventajas u oportunidades de mejora. Devuelve un análisis conciso y accionable para el dueño de la tienda. Omitir introducciones. \n\nRESEÑAS DEL PRODUCTO:\n${JSON.stringify(p.reviews)}`,
                                     config: { systemInstruction: "Eres un analista de datos y sentimientos para L'Essentiel boutique minimalista." }
                                 });
                                 alert(`ANÁLISIS IA (GEMINI) PARA: ${p.name}\n\n${response.text}`);
                               } catch (e) {
                                 showToast("Error analizando opiniones");
                               }
                            }} className="text-[0.65rem] text-ink flex items-center gap-1 hover:underline mt-2 ml-14 w-fit">
                              <Sparkles size={10}/> Resumen de Opiniones
                            </button>
                          )}
                       </td>
                       <td className="py-4">${p.price.toFixed(2)}</td>
                       <td className="py-4">{p.stock}</td>
                       <td className="py-4 text-right">
                         <button onClick={() => handleEditProduct(p)} className="text-ink hover:text-black text-[0.7rem] uppercase tracking-widest mr-4">Editar</button>
                         <button onClick={() => handleDeleteProduct(p.id)} className="text-red-500 hover:text-red-700 text-[0.7rem] uppercase tracking-widest">Eliminar</button>
                       </td>
                     </tr>
                   ))}
                 </tbody>
               </table>
             </div>
           </div>
         ) : adminTab === 'orders' ? (
           <div className="flex flex-col gap-12">
             <div className="flex flex-col lg:flex-row gap-6 mb-8">
                <div className="bg-white p-6 border border-black/5 flex-grow">
                   <p className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2">Ingresos Totales (Pagados/Enviados)</p>
                   <p className="font-serif text-[2.5rem] italic text-ink">${totalSales.toFixed(2)}</p>
                   <p className="text-[0.75rem] text-ink/60 mt-1">Órdenes encontradas: {filteredOrders.length}</p>
                </div>

                <div className="bg-white p-6 border border-black/5 flex flex-col md:flex-row gap-6 items-center">
                   <div className="flex flex-col">
                      <label className="text-[0.6rem] uppercase tracking-widest text-ink-light mb-2">Fecha de Inicio</label>
                      <input 
                        type="date" 
                        value={adminStartDate} 
                        onChange={(e) => setAdminStartDate(e.target.value)}
                        className="border border-black/10 p-2 text-[0.8rem] text-ink outline-none focus:border-ink transition-colors cursor-pointer"
                      />
                   </div>
                   <div className="flex flex-col">
                      <label className="text-[0.6rem] uppercase tracking-widest text-ink-light mb-2">Fecha de Fin</label>
                      <input 
                        type="date" 
                        value={adminEndDate} 
                        onChange={(e) => setAdminEndDate(e.target.value)}
                        className="border border-black/10 p-2 text-[0.8rem] text-ink outline-none focus:border-ink transition-colors cursor-pointer"
                      />
                   </div>
                   {(adminStartDate || adminEndDate) && (
                     <button 
                       onClick={() => { setAdminStartDate(''); setAdminEndDate(''); }}
                       className="text-[0.65rem] uppercase tracking-widest border-b border-ink/30 hover:border-ink pb-0.5 text-ink/70 hover:text-ink mt-4 md:mt-4 transition-colors cursor-pointer"
                     >
                        Limpiar Filtro
                     </button>
                   )}
                </div>
             </div>

             <div className="bg-white border border-black/5 p-6 overflow-x-auto">
               <table className="w-full text-left">
                 <thead>
                   <tr className="border-b border-black/5 text-[0.7rem] uppercase tracking-widest text-ink-light">
                     <th className="pb-4 font-normal">Fecha</th>
                     <th className="pb-4 font-normal">Usuario</th>
                     <th className="pb-4 font-normal">Dirección</th>
                     <th className="pb-4 font-normal">Total</th>
                     <th className="pb-4 font-normal">Estado</th>
                     <th className="pb-4 font-normal text-right">Acción</th>
                   </tr>
                 </thead>
                 <tbody>
                   {filteredOrders.sort((a,b)=> new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(o => (
                     <tr key={o.id} className="border-b border-black/5 last:border-0 text-[0.85rem]">
                       <td className="py-4">{new Date(o.createdAt).toLocaleDateString()}</td>
                       <td className="py-4 truncate max-w-[150px]">{o.userId}</td>
                       <td className="py-4 truncate max-w-[200px]" title={o.address}>{o.address || 'Pendiente'}</td>
                       <td className="py-4 font-bold text-ink">${o.total.toFixed(2)}</td>
                       <td className="py-4 uppercase tracking-widest text-[0.65rem]">
                          <span className={`px-2 py-1 ${o.status === 'pagado' ? 'bg-yellow-100 text-yellow-800' : o.status === 'enviado' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>{o.status}</span>
                       </td>
                       <td className="py-4 text-right">
                         {o.status === 'pagado' && (
                           <button 
                             onClick={async () => {
                                // Find user email. For a real app we'd save user email in order doc. 
                                // Here we fallback since we added address anyway.
                                const uEmail = user?.email || 'test@test.com'; // using current user email as fallback if order doesn't have it
                                await updateOrderStatus(o.id, 'enviado', uEmail);
                             }} 
                             className="text-ink hover:text-black border-b border-ink pb-0.5 text-[0.7rem] uppercase tracking-widest cursor-pointer"
                           >
                             Marcar Envío
                           </button>
                         )}
                       </td>
                     </tr>
                   ))}
                   {filteredOrders.length === 0 && (
                      <tr><td colSpan={6} className="text-center py-8 text-ink-light italic">No hay órdenes en este periodo.</td></tr>
                   )}
                 </tbody>
               </table>
             </div>
           </div>
        ) : adminTab === 'chats' ? (
           <div className="flex gap-8 h-[600px]">
             {/* Chat List */}
             <div className="w-1/3 bg-white border border-black/5 overflow-y-auto">
                <div className="p-4 border-b border-black/5 bg-cream/50">
                   <h3 className="uppercase text-[0.7rem] tracking-widest text-ink font-bold">Solicitudes de Atención</h3>
                </div>
                {adminActiveChats.map(chat => (
                   <div 
                     key={chat.id} 
                     onClick={() => setViewingChat(chat)}
                     className={`p-4 border-b border-black/5 cursor-pointer hover:bg-black/5 transition-colors ${viewingChat?.id === chat.id ? 'bg-black/5 border-l-4 border-l-ink' : ''} ${chat.status==='waiting_human' ? 'bg-yellow-50' : ''}`}
                   >
                      <div className="flex justify-between items-start mb-1">
                         <span className="text-[0.7rem] truncate font-bold">{chat.userEmail}</span>
                         <span className="text-[0.6rem] text-ink-light">{new Date((chat.updatedAt as any).seconds ? (chat.updatedAt as any).seconds*1000 : chat.updatedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
                      </div>
                      <div className="flex justify-between items-end">
                         <span className="text-[0.75rem] text-ink-light truncate max-w-[150px]">{chat.messages[chat.messages.length - 1]?.text}</span>
                         <span className={`text-[0.6rem] uppercase px-1 py-0.5 rounded ${chat.status==='waiting_human'?'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>{chat.status.replace('_',' ')}</span>
                      </div>
                   </div>
                ))}
                {adminActiveChats.length === 0 && <p className="text-[0.8rem] text-ink-light p-4 text-center italic">No hay chats activos.</p>}
             </div>
             
              {/* Chat Details & Interaction */}
              <div className="w-2/3 bg-white border border-black/5 flex flex-col">
                {viewingChat ? (() => {
                  const activeChat = adminActiveChats.find(c => c.id === viewingChat.id) || viewingChat;
                  return (
                   <>
                     <div className="p-4 border-b border-black/5 bg-cream/50 flex justify-between items-center">
                        <span className="text-[0.85rem] font-bold">{activeChat.userEmail}</span>
                        <div className="flex gap-4">
                           {activeChat.status === 'waiting_human' && (
                              <button 
                                onClick={async () => {
                                   try {
                                      const assignedName = user?.displayName || 'Asesor';
                                      await updateDoc(doc(db, 'chats', activeChat.id), { status: 'active_human', assignedAdmin: assignedName });
                                      showToast('Chat asignado a ti');

                                      await fetch('/api/send-email', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                           to: activeChat.userEmail,
                                           fromType: 'support',
                                           subject: 'Un asesor ha tomado tu caso - L\'Essentiel',
                                           text: `${assignedName} te está ayudando ahora.`,
                                           html: `
                                             <div style="background-color: #F5F5F0; padding: 60px 20px; font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; line-height: 1.6;">
                                                <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #eeeeee; padding: 60px 40px; text-align: center;">
                                                  <h2 style="font-size: 24px; font-family: Georgia, serif; font-style: italic; margin-bottom: 20px;">¡Hola!</h2>
                                                  <p style="font-size: 16px; margin-bottom: 20px; color: #666666;"><strong>${assignedName}</strong> ha tomado tu caso y te está ayudando en este momento. Revisa la ventana de chat para continuar la conversación.</p>
                                                </div>
                                             </div>
                                           `
                                        })
                                      });
                                   } catch(e) { }
                                }}
                                className="text-[0.7rem] uppercase tracking-widest bg-ink text-white px-3 py-1 hover:bg-black"
                              >
                                Tomar Caso
                              </button>
                           )}
                           {(activeChat.status === 'active_human' || activeChat.status === 'waiting_human') && (
                              <>
                                <button 
                                  onClick={async () => {
                                     try {
                                        await updateDoc(doc(db, 'chats', activeChat.id), { status: 'closed' });
                                        
                                        // Send email: Ticket closed
                                        await fetch('/api/send-email', {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({
                                             to: activeChat.userEmail,
                                             fromType: 'support',
                                             subject: 'Tu caso ha sido cerrado - L\'Essentiel',
                                             text: `El caso de soporte ha finalizado.`,
                                             html: `
                                               <div style="background-color: #F5F5F0; padding: 60px 20px; font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; line-height: 1.6;">
                                                  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #eeeeee; padding: 60px 40px; text-align: center;">
                                                    <h2 style="font-size: 24px; font-family: Georgia, serif; font-style: italic; margin-bottom: 20px;">¡Gracias por contactarnos!</h2>
                                                    <p style="font-size: 16px; margin-bottom: 20px; color: #666666;">Esperamos haber resuelto tus dudas. Si cambias de opinión, puedes abrir un nuevo chat.</p>
                                                  </div>
                                               </div>
                                             `
                                          })
                                        });
                                        showToast('Chat finalizado');
                                        setViewingChat(null);
                                     } catch(e) {}
                                  }}
                                  className="text-[0.7rem] uppercase tracking-widest border border-ink text-ink px-3 py-1 hover:bg-ink/5"
                                >
                                  Finalizar
                                </button>
                                <button 
                                  onClick={async () => {
                                     try {
                                        await updateDoc(doc(db, 'chats', activeChat.id), { status: 'closed' });
                                        
                                        // Send email: Ticket closed inactivity
                                        await fetch('/api/send-email', {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({
                                             to: activeChat.userEmail,
                                             fromType: 'support',
                                             subject: 'Chat finalizado por inactividad - L\'Essentiel',
                                             text: `Tu caso de soporte ha finalizado por falta de respuesta.`,
                                             html: `
                                               <div style="background-color: #F5F5F0; padding: 60px 20px; font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; line-height: 1.6;">
                                                  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #eeeeee; padding: 60px 40px; text-align: center;">
                                                    <h2 style="font-size: 24px; font-family: Georgia, serif; font-style: italic; margin-bottom: 20px;">¡Hola!</h2>
                                                    <p style="font-size: 16px; margin-bottom: 20px; color: #666666;">Como no hemos recibido respuesta de tu parte, hemos procedido a finalizar este chat para poder atender a otros clientes.</p>
                                                    <p style="font-size: 16px; color: #666666;">Si aún necesitas ayuda, no dudes en abrir un nuevo caso de soporte desde la plataforma. ¡Estamos para servirte!</p>
                                                  </div>
                                               </div>
                                             `
                                          })
                                        });
                                        showToast('Cerrado por inactividad');
                                        setViewingChat(null);
                                     } catch(e) {}
                                  }}
                                  className="text-[0.7rem] uppercase tracking-widest border border-yellow-600 text-yellow-700 px-3 py-1 hover:bg-yellow-50"
                                >
                                  Inactividad
                                </button>
                              </>
                           )}
                        </div>
                     </div>
                     <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-[#fcfcfb]">
                        {activeChat.messages.map((m, idx) => (
                           <div key={idx} className={`max-w-[80%] p-3 rounded-lg text-[0.85rem] ${m.sender === 'user' ? 'bg-gray-200 text-ink self-start' : 'bg-ink text-white self-end'}`}>
                              <p className="text-[0.6rem] opacity-50 mb-1 uppercase tracking-widest">{m.sender}</p>
                              {m.imageUrl ? <img src={m.imageUrl} className="max-w-full rounded mt-1" alt="Chat img" /> : null}
                              {m.text && <p>{m.text}</p>}
                           </div>
                        ))}
                     </div>
                     {activeChat.status === 'active_human' && (
                        <form 
                          className="p-3 border-t border-black/5 bg-white flex gap-2 items-center"
                          onSubmit={async (e) => {
                             e.preventDefault();
                             if (!adminChatInput.trim()) return;
                             try {
                                const newMsg: ChatMessage = { id: Date.now().toString(), sender: 'admin', text: adminChatInput.trim(), timestamp: new Date() };
                                await updateDoc(doc(db, 'chats', activeChat.id), { messages: arrayUnion(newMsg), updatedAt: new Date() });
                                setAdminChatInput('');
                             } catch(e){}
                          }}
                        >
                           <label className="cursor-pointer p-2 hover:bg-black/5 rounded">
                             <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                               const file = e.target.files?.[0];
                               if(!file) return;
                               const reader = new FileReader();
                               reader.onload = async (ev) => {
                                 const b64 = ev.target?.result as string;
                                 try {
                                   const newMsg: ChatMessage = { id: Date.now().toString(), sender: 'admin', text: '', isImage: true, imageUrl: b64, timestamp: new Date() };
                                   await updateDoc(doc(db, 'chats', activeChat.id), { messages: arrayUnion(newMsg), updatedAt: new Date() });
                                 } catch(err){}
                               };
                               reader.readAsDataURL(file);
                             }} />
                             <ImageIcon size={20} className="text-ink-light" />
                           </label>
                           <input 
                              type="text" 
                              value={adminChatInput}
                              onChange={(e) => setAdminChatInput(e.target.value)}
                              placeholder="Escribe un mensaje..."
                              className="flex-1 border border-black/10 px-3 py-2 text-[0.85rem] outline-none"
                           />
                           <button type="submit" className="bg-ink text-white px-4 py-2 hover:bg-black text-[0.8rem]"><Send size={16}/></button>
                        </form>
                     )}
                     {activeChat.status === 'waiting_human' && (
                        <div className="p-4 bg-yellow-50 text-center text-[0.8rem] text-yellow-800">
                           Debes tomar el caso para poder responder.
                        </div>
                     )}
                   </>
                  );
                })() : (
                   <div className="flex-1 flex items-center justify-center text-ink-light text-[0.85rem] italic">Selecciona un chat del panel lateral.</div>
                )}
             </div>
           </div>
        ) : adminTab === 'promos' ? (
           <div className="flex flex-col gap-12">
             <div className="flex justify-between items-center">
               <h2 className="font-bold text-[1.2rem]">Códigos Promocionales y Gift Cards</h2>
             </div>
             
             <form onSubmit={handleAddPromo} className="bg-white p-8 border border-black/5 grid grid-cols-1 md:grid-cols-4 gap-6 items-end">
               <div>
                 <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Código</label>
                 <input required type="text" value={newPromo.code} onChange={e => setNewPromo({...newPromo, code: e.target.value.toUpperCase()})} placeholder="EJ: VERANO20" className="w-full border border-black/10 p-3 text-[0.85rem] outline-none uppercase" />
               </div>
               <div>
                 <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Descuento (%)</label>
                 <input required type="number" min="1" max="100" value={newPromo.discountPercent || ''} onChange={e => setNewPromo({...newPromo, discountPercent: Number(e.target.value)})} placeholder="20" className="w-full border border-black/10 p-3 text-[0.85rem] outline-none" />
               </div>
               <div>
                 <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Tipo</label>
                 <select value={newPromo.type} onChange={e => setNewPromo({...newPromo, type: e.target.value as any})} className="w-full border border-black/10 p-3 text-[0.85rem] outline-none bg-transparent">
                   <option value="promo">Promo Code</option>
                   <option value="giftcard">Gift Card</option>
                 </select>
               </div>
               <button type="submit" className="bg-ink text-white py-3 text-[0.8rem] uppercase tracking-widest hover:bg-black">Crear Código</button>
             </form>

             <div className="bg-white border border-black/5 p-6 overflow-x-auto">
               <table className="w-full text-left">
                 <thead>
                   <tr className="border-b border-black/5 text-[0.7rem] uppercase tracking-widest text-ink-light">
                     <th className="pb-4 font-normal">CÓDIGO</th>
                     <th className="pb-4 font-normal">TIPO</th>
                     <th className="pb-4 font-normal">DESCUENTO</th>
                     <th className="pb-4 font-normal">ESTADO</th>
                     <th className="pb-4 font-normal text-right">ACCIONES</th>
                   </tr>
                 </thead>
                 <tbody>
                   {promos.map(p => (
                     <tr key={p.id} className="border-b border-black/5 last:border-0 text-[0.85rem]">
                       <td className="py-4 font-bold">{p.code}</td>
                       <td className="py-4 capitalize">{p.type}</td>
                       <td className="py-4">{p.discountPercent}%</td>
                       <td className="py-4">
                         <span className={`px-2 py-1 text-[0.6rem] uppercase tracking-widest ${p.active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                           {p.active ? 'Activo' : 'Inactivo'}
                         </span>
                       </td>
                       <td className="py-4 text-right">
                         <button onClick={async () => {
                           await updateDoc(doc(db, 'promos', p.id), { active: !p.active });
                         }} className="text-ink hover:text-black text-[0.7rem] uppercase tracking-widest mr-4">
                           Toggle
                         </button>
                         <button onClick={() => handleDeletePromo(p.id)} className="text-red-500 hover:text-red-700 text-[0.7rem] uppercase tracking-widest">Eliminar</button>
                       </td>
                     </tr>
                   ))}
                   {promos.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-ink-light italic">No hay códigos creados</td></tr>}
                 </tbody>
               </table>
             </div>
           </div>
        ) : adminTab === 'config' ? (
           <div className="flex flex-col gap-12">
             <div className="flex justify-between items-center">
               <h2 className="font-bold text-[1.2rem]">Configuración Global</h2>
             </div>
             <form onSubmit={handleSaveConfig} className="bg-white p-8 border border-black/5 grid grid-cols-1 md:grid-cols-2 gap-6 items-end max-w-lg">
               <div>
                 <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Tasa de Impuestos (%) <br/><span className="text-[0.55rem] normal-case">(Se aplica en el carrito)</span></label>
                 <input type="number" step="0.01" min="0" value={configInput.taxRate} onChange={e => setConfigInput({...configInput, taxRate: Number(e.target.value)})} className="w-full border border-black/10 p-3 text-[0.85rem] outline-none" />
               </div>
               <button type="submit" className="bg-ink text-white py-3 text-[0.8rem] uppercase tracking-widest hover:bg-black">Guardar Impuestos</button>
             </form>
           </div>
        ) : adminTab === 'campaigns' ? (
           <div className="flex flex-col gap-12">
              <div className="flex justify-between items-center">
                 <h2 className="font-bold text-[1.2rem]">Campañas de Mailing Masivas</h2>
              </div>
              <form onSubmit={async (e) => {
                 e.preventDefault();
                 const fd = new FormData(e.currentTarget);
                 const target = fd.get('target') as string;
                 const customEmail = fd.get('customEmail') as string;
                 const subject = fd.get('subject') as string;
                 const htmlContent = fd.get('htmlContent') as string;
                 
                 let recipients: string[] = [];
                 if (target === 'all') {
                    import('firebase/firestore').then(async ({ getDocs, collection }) => {
                       try {
                         const snap = await getDocs(collection(db, 'users'));
                         const docs = snap.docs.map(d=>d.data());
                         // We don't save email in standard user doc except if they register? Wait, Firebase Auth keeps it. 
                         // For emails we might need a cloud function or we just fallback to the manual list if not stored.
                         // But we can fallback to address string if it contains '@' from orders.
                         const emails = new Set<string>();
                         orders.forEach(o => { if (o.userEmail) emails.add(o.userEmail); });
                         docs.forEach(d => { if (d.email) emails.add(d.email); });
                         
                         recipients = Array.from(emails);
                         if (recipients.length === 0) {
                            showToast('No se encontraron correos. Usa la prueba manual o asegúrate de que existen órdenes con email.');
                            return;
                         }
                         deliverMails();
                       } catch(e) {}
                    });
                    return; // exit while async fetch resolves
                 } else {
                    recipients = [customEmail];
                    deliverMails();
                 }
                 
                 async function deliverMails() {
                    showToast(`Enviando a ${recipients.length} destinatario(s)...`);
                    for (const rec of recipients) {
                        if (!rec || !rec.includes('@')) continue;
                        await fetch('/api/send-email', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                             to: rec,
                             fromType: 'team',
                             subject: subject,
                             text: 'Abre este correo en HTML.',
                             html: htmlContent
                          })
                        }).catch(()=>null);
                    }
                    showToast('Campaña enviada exitosamente.');
                    (e.target as HTMLFormElement).reset();
                 }
              }} className="bg-white p-8 border border-black/5 flex flex-col gap-6 w-full max-w-4xl">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Destinatario</label>
                      <select name="target" id="campaignTarget" className="w-full border border-black/10 p-3 text-[0.85rem] outline-none bg-transparent mb-4" onChange={(e)=>{
                         const customEl = document.getElementById('customEmailWrapper');
                         if (customEl) customEl.style.display = e.target.value === 'custom' ? 'block' : 'none';
                      }}>
                         <option value="custom">Email Específico</option>
                         <option value="all">Todos los Compradores</option>
                      </select>
                      <div id="customEmailWrapper">
                         <input name="customEmail" type="email" placeholder="cliente@correo.com" className="w-full border border-black/10 p-3 text-[0.85rem] outline-none" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[0.7rem] uppercase tracking-widest text-ink-light mb-2 block">Asunto</label>
                      <input name="subject" required type="text" placeholder="¡Llegó la nueva colección! ✨" className="w-full border border-black/10 p-3 text-[0.85rem] outline-none" />
                    </div>
                 </div>
                 
                 <div>
                    <div className="flex justify-between items-center mb-2">
                       <label className="text-[0.7rem] uppercase tracking-widest text-ink-light block">Contenido HTML</label>
                       <button type="button" onClick={async () => {
                           const p = prompt("¿Qué quieres que incluya este email? (Ej: Una venta flash del 20% en abrigos de invierno)");
                           if (!p) return;
                           showToast("Diseñando y redactando campaña con IA...");
                           try {
                             const response = await ai.models.generateContent({
                                 model: "gemini-3.1-pro-preview",
                                 contents: `Genera el código HTML para una campaña de correo basada en esta solicitud: "${p}".
ESTRICTO: El diseño debe ser idéntico al estilo transaccional de L'Essentiel.
Usa el siguiente contenedor base obligatorio: <div style="padding: 40px; font-family: 'Georgia', serif; color: #1a1a1a; max-width: 600px; margin: auto; border: 1px solid #f0f0f0;">
Título principal: <h2 style="font-style: italic; font-weight: normal; margin-bottom: 24px;"></h2>
Botones de CTA call-to-action DEBEN ESTAR en: <a style="display:inline-block; padding: 12px 24px; background-color: #1a1a1a; color: #ffffff; text-decoration: none; font-family: sans-serif; font-size: 11px; letter-spacing: 2px; text-transform: uppercase;"></a>. 
Haz que el copy del email sea atractivo. DEVUELVE SOLO EL CÓDIGO HTML PURO (sin delimitadores markdown extraños como \`\`\`html) para poder insertarlo directo.`,
                                 config: { systemInstruction: "Eres un diseñador y experto marketing web full-stack para L'Essentiel, una boutique minimalista." }
                             });
                             const textArea = document.querySelector('textarea[name="htmlContent"]') as HTMLTextAreaElement;
                             if(textArea) {
                               textArea.value = response.text || '';
                             }
                             showToast("Campaña generada ✨");
                           } catch(e) {
                             showToast("Error generando diseño de campaña");
                           }
                       }} className="text-[0.65rem] uppercase tracking-widest text-ink flex items-center gap-1 hover:underline cursor-pointer">
                          <Sparkles size={12}/> Redactar HTML con IA
                       </button>
                    </div>
                    <textarea name="htmlContent" required rows={12} className="w-full border border-black/10 p-3 text-[0.85rem] outline-none font-mono focus:border-ink resize-none bg-cream/10" placeholder="<div style='padding:40px; color:#1a1a1a;'>" />
                    <p className="text-[0.6rem] text-ink-light uppercase mt-2">Puedes escribir el código HTML manualmente o generarlo mediante nuestra Inteligencia Artificial.</p>
                 </div>
                 
                 <div className="flex justify-end">
                    <button type="submit" className="bg-ink text-white py-3 px-8 text-[0.8rem] uppercase tracking-widest hover:bg-black cursor-pointer flex items-center gap-2">
                       <Send size={14} /> Lanzar Campaña
                    </button>
                 </div>
              </form>
           </div>
        ) : null}
      </div>
    );
  };

  const FloatingChat = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [currentChat, setCurrentChat] = useState<Chat | null>(null);
    const [inputMessage, setInputMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [showChatList, setShowChatList] = useState(false);
    const [userChats, setUserChats] = useState<Chat[]>([]);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Fetch user chats when logged in
    useEffect(() => {
      if (!user || user.email?.includes('ticketpro.lat') || user.email === 'gaboleandro189@gmail.com') return;
      const q = query(collection(db, 'chats'), where('userId', '==', user.uid), orderBy('updatedAt', 'desc'));
      const unsub = onSnapshot(q, (snap) => {
        const chts = snap.docs.map(d => ({ id: d.id, ...d.data() } as Chat));
        setUserChats(chts);
        
        // Auto select active chat if it exists
        if (!currentChat && chts.length > 0) {
           const active = chts.find(c => c.status !== 'closed');
           if (active) setCurrentChat(active);
        } else if (currentChat) {
           const updated = chts.find(c => c.id === currentChat.id);
           if (updated) setCurrentChat(updated);
        }
      }, (err) => console.warn("User chats sync error:", err));
      return () => unsub();
    }, [user, currentChat]);

    useEffect(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [currentChat?.messages]);

    const startNewChat = async () => {
      if (!user) {
        setShowLoginModal(true);
        showToast('Inicia sesión para conversar');
        return;
      }
      setIsLoading(true);
      try {
        const initMsg: ChatMessage = {
          id: Date.now().toString(),
          sender: 'ai',
          text: 'Hola, soy el asistente de L\'Essentiel. ¿En qué te puedo ayudar el día de hoy?',
          timestamp: new Date()
        };
        const newChatInfo = {
          userId: user.uid,
          userEmail: user.email,
          status: 'active_ai',
          messages: [initMsg],
          updatedAt: new Date()
        };
        const chatRef = await addDoc(collection(db, 'chats'), newChatInfo);
        setCurrentChat({ id: chatRef.id, ...newChatInfo } as Chat);
        setShowChatList(false);
      } catch (e) {
        showToast('Error iniciando chat');
      }
      setIsLoading(false);
    };

    const handleSendMessage = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!inputMessage.trim() || !currentChat || !user) return;
      if (currentChat.messages.length > 50) {
         showToast('Límite de mensajes alcanzado en este chat. Por favor inicia otra consulta.');
         return;
      }
      
      const userMsg: ChatMessage = {
        id: Date.now().toString(),
        sender: 'user',
        text: inputMessage.trim(),
        timestamp: new Date()
      };

      const updatedChat = { ...currentChat, messages: [...currentChat.messages, userMsg] };
      setCurrentChat(updatedChat);
      setInputMessage('');
      setIsLoading(true);

      try {
        await updateDoc(doc(db, 'chats', currentChat.id), {
           messages: arrayUnion(userMsg),
           updatedAt: new Date()
        });

        // AI Response Logic
        if (currentChat.status === 'active_ai') {
           const formattedMessages = updatedChat.messages.map(m => ({
              role: m.sender === 'user' ? 'user' : 'model',
              parts: [{ text: m.text }]
           }));

           let responseText = '';
           try {
             const response = await ai.models.generateContent({
                 model: "gemini-3-flash-preview",
                 contents: formattedMessages as any,
                 config: {
                   systemInstruction: "Eres un elegante y breve asistente para L'Essentiel, una boutique minimalista de alta moda. Si el usuario pide hablar de forma explícita con un humano sobre una solicitud de soporte, soporte sobre problemas del sistema, reembolsos de dinero en tarjeta que no puedes resolver, responde ESTRICTAMENTE en tu texto con '[ESCALAR]'. Si la duda fue resuelta y se despiden cordialmente, responde ESTRICTAMENTE con '[TERMINAR]'. De lo contrario, ayúdales de forma cortés conversando con la persona de su situación.",
                   temperature: 0.7
                 }
             });
             responseText = response.text || '';
           } catch(e) {
             console.error("AI Error:", e);
           }
           
           const rawReply = responseText.trim();

           let nextStatus = currentChat.status;
           let finalReplyText = rawReply;

           if (rawReply.includes('[ESCALAR]')) {
              nextStatus = 'waiting_human';
              finalReplyText = "Por supuesto, te transferiré con un representante humano. Estás en la cola de espera, pronto te atenderemos.";
           } else if (rawReply.includes('[TERMINAR]')) {
              nextStatus = 'closed';
              finalReplyText = "¡Gracias por comunicarte con L'Essentiel! Esperamos haberte sido de gran ayuda. Califícanos.";
           }

           const aiMsg: ChatMessage = {
              id: Date.now().toString(),
              sender: 'ai',
              text: finalReplyText,
              timestamp: new Date()
           };

           await updateDoc(doc(db, 'chats', currentChat.id), {
              messages: arrayUnion(aiMsg),
              status: nextStatus,
              updatedAt: new Date()
           });

           if (nextStatus === 'waiting_human') {
              // Send Email Queue
              await fetch('/api/send-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                   to: user.email,
                   fromType: 'support',
                   subject: 'Estás en la fila de soporte - L\'Essentiel',
                   text: `Hola, un humano tomará tu ticket pronto.`,
                   html: `
                     <div style="background-color: #F5F5F0; padding: 60px 20px; font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; line-height: 1.6;">
                        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #eeeeee; padding: 60px 40px; text-align: center;">
                          <h2 style="font-size: 24px; font-family: Georgia, serif; font-style: italic; margin-bottom: 20px;">Hola${user.displayName ? `, ${user.displayName}` : ''}</h2>
                          <p style="font-size: 16px; margin-bottom: 20px; color: #666666;">Hemos recibido tu solicitud de contacto humano. Estamos con un volumen alto, pero pronto un asesor tomará tu caso y verás su nombre en la plataforma.</p>
                        </div>
                     </div>
                   `
                })
              });
           }
        }
      } catch (err) {
         console.error(err);
         showToast('Hubo un error de conexión');
      }
      setIsLoading(false);
    };

    const handleRating = async (rating: number) => {
       if (!currentChat) return;
       try {
         await updateDoc(doc(db, 'chats', currentChat.id), { rating });
         showToast('¡Gracias por evaluar nuestro servicio!');
       } catch (err) { }
    };

    if (user && (user.email?.includes('ticketpro.lat') || user.email === 'gaboleandro189@gmail.com')) return null;

    return (
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col items-end gap-2">
         {isOpen && (
           <div className="w-[350px] h-[500px] bg-white border border-black/10 shadow-2xl flex flex-col animate-in slide-in-from-bottom-2 duration-300">
              
              {/* Header */}
              <div className="bg-cream border-b border-black/5 p-4 flex justify-between items-center">
                 <h3 className="font-serif italic text-ink">{showChatList ? 'Tus Consultas' : 'Soporte L\'Essentiel'}</h3>
                 <div className="flex gap-4 items-center">
                   {!showChatList && (
                     <button onClick={() => setShowChatList(true)} title="Ver Historial" className="hover:text-ink-light text-ink cursor-pointer">
                        <Clock size={16} />
                     </button>
                   )}
                   <button onClick={() => setIsOpen(false)} className="hover:text-ink-light text-ink cursor-pointer">
                     <X size={18} />
                   </button>
                 </div>
              </div>

              {/* Chat List View */}
              {showChatList ? (
                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                  <button 
                    onClick={startNewChat}
                    className="w-full py-3 bg-ink text-white uppercase text-[0.75rem] tracking-widest hover:bg-black cursor-pointer"
                  >
                    Nueva Consulta
                  </button>
                  {userChats.map(c => (
                    <div 
                      key={c.id} 
                      onClick={() => { setCurrentChat(c); setShowChatList(false); }}
                      className="border border-black/5 p-3 cursor-pointer hover:border-black/20 flex flex-col gap-1"
                    >
                      <div className="flex justify-between items-center text-[0.7rem] uppercase tracking-widest text-ink-light">
                        <span>{new Date((c.updatedAt as any).seconds ? (c.updatedAt as any).seconds*1000 : c.updatedAt).toLocaleDateString()}</span>
                        <span className={`px-2 py-0.5 ${c.status==='closed'?'bg-gray-100':c.status==='waiting_human'?'bg-yellow-100 text-yellow-800':'bg-green-100 text-green-800'}`}>
                           {c.status.replace('_',' ')}
                        </span>
                      </div>
                      <p className="text-[0.85rem] text-ink truncate w-full">{c.messages[c.messages.length-1]?.text || 'Chat'}</p>
                    </div>
                  ))}
                  {userChats.length === 0 && <p className="text-[0.8rem] text-center italic text-ink-light mt-4">Sin historial</p>}
                </div>
              ) : (
                /* Active Chat View */
                <>
                  {!currentChat ? (
                    <div className="flex-1 p-6 flex flex-col items-center justify-center text-center gap-4">
                       <MessageCircle size={32} className="text-ink-light mb-2" />
                       <p className="font-serif italic text-ink text-[1.2rem]">Estamos aquí para ti</p>
                       <p className="text-[0.8rem] text-ink-light leading-relaxed">Habla con nuestro inteligente asistente o con uno de nuestros asesores para resolver cualquier duda.</p>
                       <button onClick={startNewChat} className="bg-ink text-white px-6 py-2 uppercase text-[0.75rem] tracking-widest hover:bg-black mt-4 cursor-pointer">
                         Iniciar Chat
                       </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-[#fcfcfb]">
                        {currentChat.status === 'waiting_human' && (
                           <div className="bg-yellow-50 text-yellow-800 text-[0.75rem] p-2 text-center rounded">En espera de un agente...</div>
                        )}
                        {currentChat.status === 'active_human' && currentChat.assignedAdmin && (
                           <div className="bg-green-50 text-green-800 text-[0.75rem] p-2 text-center rounded">Conversando con {currentChat.assignedAdmin}</div>
                        )}
                        {currentChat.messages.map((m, idx) => (
                           <div key={idx} className={`max-w-[85%] p-3 text-[0.85rem] flex flex-col shadow-sm ${m.sender === 'user' ? 'bg-ink text-white self-end rounded-t-2xl rounded-bl-2xl rounded-br-sm' : 'bg-white border border-black/5 text-ink self-start rounded-t-2xl rounded-br-2xl rounded-bl-sm'}`}>
                              {m.imageUrl && <img src={m.imageUrl} alt="attached" className="max-w-full rounded mb-1" />}
                              {m.text && <span className="leading-relaxed">{m.text}</span>}
                           </div>
                        ))}
                        {isLoading && (
                           <div className="bg-white border border-black/5 text-ink self-start rounded-t-2xl rounded-br-2xl rounded-bl-sm p-3 shadow-sm flex items-center gap-1 max-w-[85%] mb-2">
                              <div className="w-1.5 h-1.5 bg-ink/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                              <div className="w-1.5 h-1.5 bg-ink/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                              <div className="w-1.5 h-1.5 bg-ink/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                           </div>
                        )}
                        
                        {currentChat.status === 'closed' && (
                           <div className="mt-4 p-4 border border-black/10 bg-white flex flex-col items-center text-center gap-2">
                             <p className="text-[0.8rem] uppercase tracking-widest text-ink-light">Chat Finalizado</p>
                             {currentChat.rating ? (
                               <p className="text-ink text-[0.8rem]">Puntuación: {currentChat.rating}/5 ⭐</p>
                             ) : (
                               <>
                                 <p className="text-[0.8rem]">¿Qué te pareció nuestro servicio?</p>
                                 <div className="flex gap-1">
                                    {[1,2,3,4,5].map(r => (
                                      <Star key={r} onClick={() => handleRating(r)} className="cursor-pointer text-black/20 hover:fill-ink hover:text-ink transition-colors" size={20} />
                                    ))}
                                 </div>
                               </>
                             )}
                           </div>
                        )}
                        <div ref={messagesEndRef} />
                      </div>

                      {/* Input Area */}
                      {currentChat.status !== 'closed' && (
                         <form onSubmit={handleSendMessage} className="p-3 bg-white border-t border-black/5 flex gap-2 items-center">
                           <input 
                              type="text"
                              value={inputMessage}
                              onChange={e => setInputMessage(e.target.value)}
                              placeholder="Escribe un mensaje..."
                              className="flex-1 bg-[#F5F5F0] rounded-full px-4 py-2 text-[0.85rem] outline-none placeholder:text-ink/40 focus:ring-1 focus:ring-ink/20"
                              disabled={isLoading}
                              maxLength={400}
                           />
                           <button type="submit" disabled={isLoading||!inputMessage.trim()} className="p-2.5 rounded-full bg-ink text-white hover:bg-black disabled:opacity-50 transition-colors cursor-pointer shadow-md">
                              <Send size={16} className={isLoading ? "opacity-50" : ""} />
                           </button>
                         </form>
                      )}
                    </>
                  )}
                </>
              )}
           </div>
         )}
         
         <button 
           onClick={() => setIsOpen(!isOpen)}
           className="bg-ink hover:bg-ink-light text-white w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105 relative cursor-pointer"
         >
            {isOpen ? <X size={24} /> : <MessageCircle size={24} />}
            {!isOpen && userChats.length > 0 && userChats[0].status === 'waiting_human' && (
              <span className="w-3 h-3 bg-red-500 rounded-full absolute top-0 right-0 animate-ping" />
            )}
         </button>
      </div>
    );
  };

  return (
    <HelmetProvider>
      <div className="min-h-screen flex flex-col font-sans selection:bg-ink selection:text-white">
        <Helmet>
           <title>{
              view === 'product' && activeProduct ? `${activeProduct.name} - L'Essentiel` :
              view === 'cart' ? "Carrito - L'Essentiel" :
              view === 'profile' ? "Mi Cuenta - L'Essentiel" :
              "L'Essentiel - Boutique Minimalista"
           }</title>
           <meta name="description" content={activeProduct ? activeProduct.description : "Una colección inspirada en el silencio y la simplicidad de lo cotidiano."} />
           <meta property="og:title" content={activeProduct ? activeProduct.name : "L'Essentiel - Boutique Minimalista"} />
           <meta property="og:description" content={activeProduct ? activeProduct.description : "Inspirados en el silencio y la simplicidad."} />
           {activeProduct && <meta property="og:image" content={activeProduct.image} />}
           <meta property="og:type" content={activeProduct ? "product" : "website"} />
        </Helmet>

        {/* Navbar */}
      <header className="sticky top-0 z-50 bg-cream/90 backdrop-blur-md border-b border-black/5">
        <div className="py-8 px-8 md:px-16 flex items-center justify-between">
          <button 
            onClick={() => setView('home')} 
            className="font-serif italic text-[1.8rem] tracking-[-1px] text-ink cursor-pointer"
          >
            L'Essentiel
          </button>

          <nav className="flex items-center gap-6 md:gap-12 text-[0.75rem] uppercase tracking-[0.1em]">
            {/* Desktop and Mobile: Search and Cart */}
            <ul className="flex items-center gap-6 md:gap-12">
               {/* Search bar toggle & input */}
              <li className="flex items-center relative">
                {isSearchOpen ? (
                  <div className="flex items-center border-b border-ink relative z-50">
                     <Search size={14} className="mr-2 text-ink" />
                     <input 
                       type="text" 
                       autoFocus
                       placeholder="BUSCAR..."
                       value={searchQuery}
                       onChange={(e) => setSearchQuery(e.target.value)}
                       className="bg-transparent border-none outline-none w-32 md:w-48 text-[0.7rem] pb-1 placeholder:text-ink/30"
                     />
                     <button onClick={() => { setIsSearchOpen(false); setSearchQuery(''); }} className="ml-2 hover:text-ink-light">
                       <X size={14} />
                     </button>
                  </div>
                ) : (
                  <button onClick={() => setIsSearchOpen(true)} className="hover:text-ink-light transition-colors cursor-pointer" aria-label="Buscar">
                     <Search size={16} />
                  </button>
                )}
                
                 {/* Dynamic Search Dropdown */}
                {isSearchOpen && (searchQuery.length > 0 || aiSearchResults) && (
                  <div className="absolute top-[calc(100%+15px)] -left-4 md:-left-12 w-[320px] md:w-[450px] bg-white border border-black/5 shadow-2xl z-[100] max-h-[500px] overflow-y-auto">
                    {/* Natural Language AI Search Section */}
                    <div className="p-4 border-b border-black/5 bg-[#F5F5F0]">
                       <div className="flex justify-between items-center mb-3">
                         <span className="text-[0.65rem] uppercase tracking-widest text-ink/70 font-bold flex items-center gap-2">
                            <Sparkles size={12} className="text-ink" /> IA Búsqueda Natural
                         </span>
                       </div>
                       <div className="flex gap-2">
                         <button 
                           onClick={handleAISearch}
                           disabled={isSearchingAI}
                           className="text-[0.7rem] bg-ink text-white uppercase tracking-wider py-2.5 px-4 hover:bg-black w-full cursor-pointer disabled:opacity-50 transition-opacity"
                         >
                           {isSearchingAI ? 'Buscando mágicamente...' : 'Búsqueda Inteligente'}
                         </button>
                       </div>
                       {!isSearchingAI && <p className="text-[0.65rem] text-ink/40 mt-3 text-center italic font-serif">Ej: "Quiero un bolso para verano"</p>}
                    </div>

                    {/* AI Results vs Standard Results */}
                    {aiSearchResults ? (
                      <div>
                        {aiSearchResults.length === 0 ? (
                           <div className="p-6 text-center text-ink-light italic text-[0.8rem] font-serif">No encontramos nada relevante con tu descripción.</div>
                        ) : (
                           aiSearchResults.map(r => (
                              <div 
                                key={r.id} 
                                onClick={() => { openProduct(r); setIsSearchOpen(false); setSearchQuery(''); setAiSearchResults(null); }}
                                className="flex items-center gap-4 p-4 border-b border-black/5 cursor-pointer hover:bg-black/5 transition-colors"
                              >
                                <img src={r.image} alt={r.name} className="w-14 h-14 object-cover" />
                                <div className="flex flex-col">
                                  <span className="font-bold text-[0.8rem] text-ink">{r.name}</span>
                                  <span className="font-serif italic text-ink-light">${r.price.toFixed(2)}</span>
                                </div>
                              </div>
                           ))
                        )}
                      </div>
                    ) : (
                      // Standard Filter 
                      (() => {
                         const results = products.filter(p => 
                           p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           p.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           p.category.toLowerCase().includes(searchQuery.toLowerCase())
                         );
                         if (results.length === 0) return <div className="p-6 text-center text-ink-light italic text-[0.8rem] font-serif">No hay coincidencias exactas. ¡Prueba la búsqueda IA!</div>;
                         return results.slice(0,5).map(r => (
                            <div 
                              key={r.id} 
                              onClick={() => { openProduct(r); setIsSearchOpen(false); setSearchQuery(''); setAiSearchResults(null); }}
                              className="flex items-center gap-3 p-3 border-b border-black/5 cursor-pointer hover:bg-black/5 transition-colors"
                            >
                              <img src={r.image} alt={r.name} className="w-10 h-10 object-cover" />
                              <div className="flex flex-col">
                                <span className="font-bold text-[0.7rem] text-ink uppercase tracking-wider">{r.name}</span>
                                <span className="font-serif italic text-ink-light">${r.price.toFixed(2)}</span>
                              </div>
                            </div>
                         ));
                      })()
                    )}
                  </div>
                )}
              </li>

              <li className="hidden md:block hover:text-ink-light cursor-pointer transition-colors font-sans uppercase tracking-[0.1em] text-[0.75rem]" onClick={() => { setActiveCategory('All'); setView('home'); }}>COLECCIÓN</li>
              
              <li className="hidden md:block">
                <button 
                  onClick={() => user ? setView('profile') : setShowLoginModal(true)} 
                  className="hover:text-ink-light transition-colors flex items-center gap-1 cursor-pointer font-sans uppercase tracking-[0.1em] text-[0.75rem]" 
                  aria-label="Wishlist"
                >
                   FAVORITOS
                </button>
              </li>

              {user && (user.email === 'gaboleandro189@gmail.com' || user.email?.includes('ticketpro.lat') || user.email?.includes('admin')) && (
                <li className="hidden md:block">
                  <button onClick={() => setView('admin')} className="hover:text-ink-light transition-colors cursor-pointer flex items-center gap-1 font-sans uppercase tracking-[0.1em] text-[0.75rem]" aria-label="Admin">
                     ADMIN
                  </button>
                </li>
              )}

              <li className="hidden md:block">
                <button onClick={() => user ? setView('profile') : setShowLoginModal(true)} className="hover:text-ink-light transition-colors cursor-pointer font-sans uppercase tracking-[0.1em] text-[0.75rem]" aria-label="Mi Cuenta">
                   PERFIL
                </button>
              </li>
              <li>
                <button 
                  className="cursor-pointer transition-opacity text-ink hover:opacity-70 flex items-center gap-2 font-sans uppercase tracking-[0.1em] text-[0.75rem]"
                  onClick={() => setView('cart')}
                >
                  <span className="hidden md:inline">CARRITO</span>
                  <ShoppingCart size={16} className="md:hidden" />
                  ({cartCount})
                </button>
              </li>
              <li className="md:hidden flex items-center">
                 <button onClick={() => setIsMobileMenuOpen(true)} className="cursor-pointer">
                    <Menu size={20} />
                 </button>
              </li>
            </ul>
          </nav>
        </div>

        {/* Mobile Menu Overlay */}
        <AnimatePresence>
          {isMobileMenuOpen && (
             <>
               <motion.div 
                 initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                 onClick={() => setIsMobileMenuOpen(false)}
                 className="fixed inset-0 bg-black/40 z-[90] md:hidden"
               />
               <motion.div 
                 initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
                 className="fixed top-0 right-0 h-full w-[280px] bg-white z-[100] shadow-2xl p-8 flex flex-col md:hidden"
               >
                  <div className="flex justify-end mb-8">
                     <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 -mr-2 cursor-pointer">
                       <X size={20} />
                     </button>
                  </div>
                  <div className="flex flex-col gap-6 text-[0.9rem] uppercase tracking-[0.1em] font-sans">
                     <button onClick={() => { setActiveCategory('All'); setView('home'); setIsMobileMenuOpen(false); }} className="text-left font-bold border-b border-black/5 pb-2">Colección</button>
                     <button onClick={() => { user ? setView('profile') : setShowLoginModal(true); setIsMobileMenuOpen(false); }} className="text-left border-b border-black/5 pb-2 flex items-center gap-2">
                        <Heart size={16} /> Favoritos
                     </button>
                     <button onClick={() => { user ? setView('profile') : setShowLoginModal(true); setIsMobileMenuOpen(false); }} className="text-left border-b border-black/5 pb-2 flex items-center gap-2">
                        <UserIcon size={16} /> Mi Perfil
                     </button>
                     {user && (user.email === 'gaboleandro189@gmail.com' || user.email?.includes('ticketpro.lat') || user.email?.includes('admin')) && (
                       <button onClick={() => { setView('admin'); setIsMobileMenuOpen(false); }} className="text-left border-b border-black/5 pb-2 flex items-center gap-2 font-bold text-ink hover:opacity-70">
                          <Settings size={16} /> Admin
                       </button>
                     )}
                  </div>
               </motion.div>
             </>
          )}
        </AnimatePresence>
      </header>

      {/* Main Content Area */}
      <main className="flex-grow">
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            {view === 'home' && <HomeView />}
            {view === 'product' && <ProductView />}
            {view === 'cart' && <CartView />}
            {view === 'about' && <AboutView />}
            {view === 'shipping' && <ShippingView />}
            {view === 'terms' && <TermsView />}
            {view === 'profile' && <ProfileView />}
            {view === 'admin' && <AdminView />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="mt-auto px-8 md:px-16 py-16 relative border-t border-black/5 bg-cream">
        <div className="max-w-[1400px] mx-auto grid grid-cols-1 md:grid-cols-3 gap-16 md:gap-12">
          {/* Column 1 */}
          <div>
            <h4 className="font-serif italic text-[1.5rem] mb-4 text-ink">L'Essentiel</h4>
            <p className="text-[0.8rem] text-ink-light leading-relaxed max-w-[250px]">
              Inspirado en el silencio y la simplicidad de lo cotidiano. Objetos, mobiliario y textiles curados con intención.
            </p>
          </div>
          
          {/* Column 2 */}
          <div className="flex flex-col gap-4 text-[0.75rem] uppercase tracking-[0.1em] text-ink/70">
            <h4 className="font-bold text-ink mb-2">Información</h4>
            <button onClick={() => { setView('about'); window.scrollTo(0,0); }} className="text-left w-max hover:text-ink transition-colors cursor-pointer">Nuestra Historia</button>
            <button onClick={() => { setView('shipping'); window.scrollTo(0,0); }} className="text-left w-max hover:text-ink transition-colors cursor-pointer">Envíos y Devoluciones</button>
            <button onClick={() => { setView('terms'); window.scrollTo(0,0); }} className="text-left w-max hover:text-ink transition-colors cursor-pointer">Términos y Condiciones</button>
          </div>

          {/* Column 3 */}
          <div>
            <h4 className="font-bold text-ink mb-4 text-[0.75rem] uppercase tracking-[0.1em]">Newsletter / Noticias</h4>
            <p className="text-[0.8rem] text-ink-light mb-6">Únete para recibir actualizaciones sobre nuevas colecciones y proyectos especiales.</p>
            <form 
              className="flex border-b border-ink/30 pb-2 hover:border-ink transition-colors" 
              onSubmit={async (e) => { 
                e.preventDefault(); 
                const form = e.target as HTMLFormElement;
                const emailInput = form.elements[0] as HTMLInputElement;
                const email = emailInput.value;
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(email)) {
                   showToast('Por favor, ingresa un correo electrónico válido');
                   return;
                }
                
                showToast('Enviando...');
                
                try {
                  const res = await fetch('/api/send-email', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      to: email,
                      fromType: 'hello',
                      emailType: 'welcome',
                      subject: 'Bienvenido a L\'Essentiel',
                      text: 'Gracias por suscribirte a nuestro Newsletter. Pronto recibirás nuestras novedades.',
                    })
                  });
                  if (res.ok) {
                    showToast('¡Gracias por suscribirte a nuestro Newsletter!'); 
                  } else {
                    throw new Error('Failed to send');
                  }
                } catch(e) {
                   showToast('Hubo un error al suscribirte.');
                }
                
                form.reset(); 
              }}
            >
              <input 
                type="email" 
                placeholder="TU CORREO ELECTRÓNICO" 
                className="bg-transparent border-none outline-none flex-1 text-[0.75rem] uppercase tracking-wider placeholder:text-ink/30 text-ink" 
                required 
              />
              <button type="submit" className="font-bold text-ink hover:text-ink-light transition-colors cursor-pointer ml-4">→</button>
            </form>
          </div>
        </div>

        <div className="max-w-[1400px] mx-auto mt-16 pt-8 border-t border-black/5 flex flex-col md:flex-row gap-4 justify-between items-center text-[0.6rem] tracking-[0.2em] text-ink/50 uppercase">
          <div>
            <span className="inline-block w-2 h-2 bg-black/20 rounded-full mr-2"></span>
            EDICIÓN LIMITADA {new Date().getFullYear()} / HECHO A MANO
          </div>
          <div>© {new Date().getFullYear()} L'ESSENTIEL</div>
        </div>
      </footer>

      {/* Login Modal */}
      {showLoginModal && (
        <div className="fixed inset-0 z-[100] bg-cream/90 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-300">
           <div className="bg-white p-12 py-16 border border-black/5 max-w-sm w-full relative mx-4 shadow-2xl overflow-y-auto max-h-[90vh]">
              <button 
                onClick={async () => {
                   if (authMode === 'otp' && user && !isVerified) {
                      await signOut(auth); // Ensure they do not stay logged in unverified
                   }
                   setShowLoginModal(false); 
                   setAuthMode('login'); 
                }}
                className="absolute top-6 right-6 hover:text-ink-light transition-colors cursor-pointer"
                aria-label="Cerrar"
              >
                <X size={20} />
              </button>
              
              {authMode === 'otp' ? (
                 <>
                   <h2 className="font-serif italic text-[2rem] mb-2 text-ink text-center">Verificación</h2>
                   <p className="text-[0.75rem] uppercase tracking-[0.1em] text-ink/50 text-center mb-8">Ingresa el código que enviamos a tu correo electrónico.</p>
                   <form onSubmit={handleVerifyOtp} className="flex flex-col gap-4">
                      <input 
                         type="text" 
                         value={otpInput}
                         onChange={e => setOtpInput(e.target.value)}
                         placeholder="CÓDIGO DE 6 DÍGITOS"
                         className="w-full border border-ink/20 p-4 text-[0.8rem] uppercase tracking-wider text-center"
                         maxLength={6}
                         required
                      />
                      <button type="submit" className="w-full bg-ink text-white py-4 mt-2 text-[0.75rem] uppercase tracking-[0.1em] hover:bg-black transition-colors">
                        Verificar Cuenta
                      </button>
                   </form>
                   <button onClick={logout} className="w-full text-center mt-6 text-[0.7rem] uppercase tracking-widest text-ink/40 hover:text-ink transition-colors underline">
                     ¿No eres tú? Salir
                   </button>
                 </>
              ) : (
                 <>
                   <h2 className="font-serif italic text-[2.5rem] mb-2 text-ink text-center">
                     {authMode === 'login' ? 'Acceder' : 'Registro'}
                   </h2>
                   <p className="text-[0.75rem] uppercase tracking-[0.1em] text-ink/50 text-center mb-8">
                     {authMode === 'login' ? 'INGRESA AL ESTILO L\'ESSENTIEL' : 'CREA TU CUENTA EXCLUSIVA'}
                   </p>
                   
                   <form onSubmit={authMode === 'login' ? handleEmailLogin : handleEmailRegister} className="flex flex-col gap-4 mb-8">
                      <input 
                         type="email" 
                         value={emailInput}
                         onChange={e => setEmailInput(e.target.value)}
                         placeholder="TU CORREO ELECTRÓNICO"
                         className="w-full border border-ink/20 p-4 text-[0.8rem] outline-none focus:border-ink"
                         required
                      />
                      <input 
                         type="password" 
                         value={passwordInput}
                         onChange={e => setPasswordInput(e.target.value)}
                         placeholder="CONTRASEÑA"
                         className="w-full border border-ink/20 p-4 text-[0.8rem] outline-none focus:border-ink"
                         required
                      />
                      <button type="submit" className="w-full bg-ink text-white py-4 mt-2 text-[0.75rem] uppercase tracking-[0.1em] hover:bg-black transition-colors cursor-pointer">
                        {authMode === 'login' ? 'Ingresar' : 'Registrarse'}
                      </button>
                   </form>

                   <div className="relative border-t border-ink/10 mb-8">
                     <span className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-4 text-[0.65rem] text-ink/40 uppercase tracking-widest">O usar</span>
                   </div>

                   <button 
                     onClick={loginGoogle} 
                     className="w-full border border-ink py-4 mb-4 text-[0.75rem] uppercase tracking-[0.1em] hover:bg-ink hover:text-white transition-colors cursor-pointer"
                   >
                     Google
                   </button>
                   <button 
                     onClick={loginTwitter} 
                     className="w-full border border-ink py-4 mb-4 text-[0.75rem] uppercase tracking-[0.1em] hover:bg-ink hover:text-white transition-colors cursor-pointer"
                   >
                     X (Twitter)
                   </button>

                   <button 
                     onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
                     className="w-full text-center mt-2 text-[0.7rem] uppercase tracking-widest text-ink/60 hover:text-ink underline transition-colors cursor-pointer"
                   >
                     {authMode === 'login' ? '¿No tienes cuenta? Regístrate aquí' : '¿Ya tienes cuenta? Ingresa aquí'}
                   </button>
                 </>
              )}
           </div>
        </div>
      )}

      {/* Floating Chat */}
      {!view.includes('admin') && <FloatingChat />}

      <Toaster position="bottom-center" />
    </div>
    </HelmetProvider>
  );
}
