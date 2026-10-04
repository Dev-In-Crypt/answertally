"use client";

import { useId, useRef, useState, type ChangeEvent } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonClass } from "@/components/ui/button";

/**
 * Выбор файла.
 *
 * Системная кнопка «Choose File / No file chosen» стояла в трёх местах
 * продукта и выглядела недоделкой рядом со всем остальным. Спрятать её
 * нельзя — выбор файла обязан оставаться настоящим `input[type=file]`,
 * иначе он перестанет работать с клавиатуры и со скринридером. Поэтому
 * поле остаётся на месте, но не видно, а вид ему задаёт подпись-кнопка.
 *
 * Имя выбранного файла показывается рядом: без него человек не знает,
 * что именно он сейчас отправит.
 */

export function FileInput({
  label,
  accept,
  onSelect,
  disabled = false,
  buttonText = "Choose file",
  hint,
  testId,
  className,
}: {
  /** Видимая подпись поля; она же связывает input с label. */
  label: string;
  accept?: string;
  onSelect: (file: File | null) => void;
  disabled?: boolean;
  buttonText?: string;
  hint?: string;
  testId?: string;
  className?: string;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string | null>(null);

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0] ?? null;
    setName(file?.name ?? null);
    onSelect(file);
    // Иначе повторный выбор того же файла событие не вызывает, а именно так
    // и чинят: поправили файл на месте и выбрали его ещё раз.
    event.target.value = "";
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>

      <div className="flex flex-wrap items-center gap-2.5">
        {/*
          Поле остаётся в потоке документа и доступно с клавиатуры: `sr-only`
          прячет его от глаз, но не от фокуса и не от скринридера. `display:
          none` сломал бы и то, и другое.
        */}
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={accept}
          disabled={disabled}
          onChange={handleChange}
          data-testid={testId}
          className="sr-only"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          // Клик по кнопке открывает то же окно, что и клик по полю; сама
          // кнопка из фокуса убрана, чтобы табом не проходить одно поле дважды.
          tabIndex={-1}
          className={buttonClass("outline", "md")}
        >
          <Upload className="size-4" aria-hidden />
          {buttonText}
        </button>
        <span className="min-w-0 truncate text-sm text-muted-foreground">
          {name ?? "No file chosen"}
        </span>
      </div>

      {hint && <p className="max-w-prose text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
