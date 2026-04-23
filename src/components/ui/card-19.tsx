import * as React from "react";
import { motion } from "framer-motion";
import { Star, Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ProductCardProps {
  title: string;
  price: number;
  currency?: string;
  rating: number;
  reviewsCount: number;
  colors: string[];
  sizes: string[];
  initialColor: string;
  initialSize: string;
  onAddToCart: (details: { color: string; size: string }) => void;
  className?: string;
  image?: string;
  isWishlisted?: boolean;
  onToggleWishlist?: (e: React.MouseEvent) => void;
}

const StarRating: React.FC<{ rating: number }> = ({ rating }) => {
  return (
    <div className="flex items-center">
      {[...Array(5)].map((_, i) => {
        const ratingValue = i + 1;
        return (
          <Star
            key={i}
            className={cn(
              "h-4 w-4",
              ratingValue <= rating
                ? "text-yellow-400 fill-yellow-400"
                : "text-gray-300"
            )}
          />
        );
      })}
    </div>
  );
};

const ProductCard: React.FC<ProductCardProps> = ({
  title,
  price,
  currency = "$",
  rating,
  reviewsCount,
  colors,
  sizes,
  initialColor,
  initialSize,
  image,
  onAddToCart,
  className,
  isWishlisted,
  onToggleWishlist,
}) => {
  const [selectedColor, setSelectedColor] = React.useState(initialColor);
  const [selectedSize, setSelectedSize] = React.useState(initialSize);

  const handleAddToCart = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAddToCart({ color: selectedColor, size: selectedSize });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeInOut" }}
      className={cn(
        "w-full max-w-sm rounded-xl border bg-card text-card-foreground shadow-lg overflow-hidden",
        className
      )}
    >
      {image && (
        <div className="w-full bg-[#EEEEEE] relative aspect-[4/5] overflow-hidden group">
           <motion.img 
              src={image} 
              loading="lazy"
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" 
              alt={title}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true, margin: "100px" }}
              transition={{ duration: 0.8 }}
            />
            {onToggleWishlist && (
               <button 
                 onClick={onToggleWishlist}
                 className="absolute top-4 right-4 z-10 p-2 bg-white/70 backdrop-blur rounded-full hover:bg-white text-ink transition-colors shadow-sm"
               >
                 <Heart size={18} className={isWishlisted ? "fill-ink text-ink" : "text-ink"} />
               </button>
            )}
        </div>
      )}
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
          <p className="text-2xl font-semibold text-primary">
            {currency}{price}
          </p>
        </div>

        <div className="flex items-center gap-2 mb-6">
          <StarRating rating={rating} />
          <span className="text-sm text-muted-foreground">
            {rating.toFixed(1)} ({reviewsCount} reviews)
          </span>
        </div>

        {colors && colors.length > 0 && (
            <div className="mb-6">
            <label className="text-sm font-medium text-muted-foreground">Color</label>
            <div className="flex items-center gap-3 mt-2" role="radiogroup">
                {colors.map((color) => (
                <motion.button
                    key={color}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setSelectedColor(color); }}
                    style={{ backgroundColor: color }}
                    className={cn(
                    "h-8 w-8 rounded-full border-2 transition-transform duration-200",
                    selectedColor === color
                        ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                        : "border-transparent text-transparent"
                    )}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                    aria-label={`Select color ${color}`}
                    role="radio"
                    aria-checked={selectedColor === color}
                >
                   .
                </motion.button>
                ))}
            </div>
            </div>
        )}

        {sizes && sizes.length > 0 && (
            <div className="mb-8">
            <div className="flex items-baseline justify-between mb-2">
                <label className="text-sm font-medium text-muted-foreground">Size</label>
            </div>
            <div className="grid grid-cols-4 gap-2">
                {sizes.map((size) => (
                <Button
                    key={size}
                    variant={selectedSize === size ? "default" : "outline"}
                    onClick={(e) => { e.stopPropagation(); setSelectedSize(size); }}
                    className="transition-all duration-200 border border-black"
                >
                    {size}
                </Button>
                ))}
            </div>
            </div>
        )}

        <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.9 }}>
          <Button size="lg" className="w-full h-12 text-base bg-black text-white hover:bg-black/80 transition-colors" onClick={handleAddToCart}>
            Agregar al Carrito
          </Button>
        </motion.div>
      </div>
    </motion.div>
  );
};

export { ProductCard };
