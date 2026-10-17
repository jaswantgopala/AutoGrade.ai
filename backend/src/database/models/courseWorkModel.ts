import mongoose ,{ Schema, Document } from 'mongoose';

export interface CourseWork extends Document {
    id: string;
    googleId: string;
    courseWorkId: string;
    courseId: string;
    maxScore: number;
    strictness:'Easy' | 'Medium' | 'Hard';
    rubricContext: string;
    createdAt: Date;
    updatedAt: Date;
}

const courseWorkSchema = new Schema<CourseWork>({
    googleId: { ref: 'User', type: String, required: true },
    courseWorkId: { type: String, required: true },
    courseId: { type: String, required: true },
    maxScore: { type: Number, required: true },
    strictness: { type: String, required: true },
    rubricContext: { type: String, required: true },

},{
    timestamps: true,
});

export default mongoose.model<CourseWork>('CourseWork', courseWorkSchema);