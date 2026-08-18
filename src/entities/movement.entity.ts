import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Item } from './item.entity';

/** Direction of a stock change. Stored as a PostgreSQL enum. */
export enum MovementType {
  IN = 'IN',
  OUT = 'OUT',
}

/**
 * An append-only ledger entry.
 *
 * There is no update or delete: rewriting history would break the guarantee
 * that an item's stock equals the sum of its movements. Mistakes are corrected
 * by recording an opposite movement.
 */
@Entity('movements')
export class Movement {
  @ApiProperty({ example: 1 })
  @PrimaryGeneratedColumn()
  id: number;

  @ApiProperty({ example: 1 })
  @Column({ name: 'item_id' })
  itemId: number;

  @ApiProperty({ enum: MovementType, example: MovementType.IN })
  @Column({ type: 'enum', enum: MovementType, enumName: 'movement_type' })
  type: MovementType;

  @ApiProperty({ example: 25, description: 'Always positive; direction comes from `type`' })
  @Column()
  quantity: number;

  @ApiProperty({ example: 'Supplier delivery', nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  @ApiProperty({
    example: 67,
    description: 'Stock right after this movement, so history is auditable',
  })
  @Column({ name: 'resulting_stock' })
  resultingStock: number;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ApiProperty({ type: () => Item, required: false })
  @ManyToOne(() => Item, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'item_id' })
  item?: Item;
}
