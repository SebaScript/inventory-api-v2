import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Item } from '../../items/entities/item.entity';

/**
 * A logical category that items belong to (for example "Electronics").
 *
 * Group names are unique **case-insensitively**, enforced by the
 * `ux_groups_name_lower` functional unique index created in the initial
 * migration. TypeORM cannot express a functional index portably, so the
 * constraint lives in SQL and the service layer surfaces a friendly 409.
 */
@Entity('groups')
export class Group {
  @ApiProperty({ example: 1, description: 'Unique group identifier' })
  @PrimaryGeneratedColumn({ type: 'int' })
  id: number;

  @ApiProperty({ example: 'Electronics', maxLength: 80 })
  @Index('idx_groups_name')
  @Column({ type: 'varchar', length: 80 })
  name: string;

  @ApiProperty({
    example: 'Consumer electronics and computer accessories',
    maxLength: 255,
    nullable: true,
  })
  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @ApiProperty({ example: '2026-08-16T10:00:00.000Z' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ example: '2026-08-16T10:00:00.000Z' })
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  /**
   * Deleting a group that still holds items is rejected at the database level
   * (`ON DELETE RESTRICT`); the service translates that into a 409 rather than
   * silently cascading and destroying inventory data.
   */
  @OneToMany(() => Item, (item) => item.group)
  items?: Item[];
}
